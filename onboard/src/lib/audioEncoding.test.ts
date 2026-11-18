import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { buildMp4Filter, normalizeEditRecipe } from './recipe';
import { buildStitchFilter } from './stitchRecipe';

type TestCore = {
  exec: (...args: string[]) => void;
  ret: number;
  reset: () => void;
  FS: {
    readFile: (path: string) => Uint8Array;
  };
};

test('bundled encoder preserves trimmed and retimed audio and stitches silent clips', async () => {
  const previousSelf = Object.getOwnPropertyDescriptor(globalThis, 'self');
  Object.defineProperty(globalThis, 'self', {
    configurable: true,
    value: { location: { href: 'file:///ffmpeg-core.js' } },
  });
  try {
    const require = createRequire(import.meta.url);
    const createCore: (options: {
      wasmBinary: Buffer;
      print: (message: string) => void;
      printErr: (message: string) => void;
    }) => Promise<TestCore> = require('@ffmpeg/core');
    const logs: string[] = [];
    const core = await createCore({
      wasmBinary: readFileSync(require.resolve('@ffmpeg/core/wasm')),
      print: (message) => logs.push(message),
      printErr: (message) => logs.push(message),
    });
    const run = (...args: string[]) => {
      logs.length = 0;
      core.exec(...args);
      assert.equal(core.ret, 0, logs.slice(-10).join('\n'));
      core.reset();
    };
    const peak = (samples: Float32Array, start: number, end: number) => {
      let maximum = 0;
      for (let index = start * 48000; index < Math.min(end * 48000, samples.length); index += 1) {
        maximum = Math.max(maximum, Math.abs(samples[index]));
      }
      return maximum;
    };
    const decodeAudio = (input: string, output: string) => {
      run('-i', input, '-map', '0:a:0', '-ac', '1', '-ar', '48000', '-c:a', 'pcm_f32le', '-f', 'f32le', output);
      const bytes = core.FS.readFile(output);
      return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / Float32Array.BYTES_PER_ELEMENT);
    };

    run(
      '-f', 'lavfi', '-i', 'testsrc2=size=64x48:rate=30:duration=4',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=4',
      '-filter:a', "volume='if(lt(t,2),1,0.25)':eval=frame",
      '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', 'source.mp4',
    );
    const recipe = normalizeEditRecipe({
      segments: [
        { startTime: 0.5, endTime: 1.5, playbackRate: 2 },
        { startTime: 2, endTime: 3, playbackRate: 0.5 },
      ],
      rotation: 0,
      crop: { x: 0, y: 0, width: 1, height: 1 },
    }, 4);
    run(
      '-i', 'source.mp4', '-filter_complex', buildMp4Filter(recipe, true),
      '-map', '[out]', '-map', '[aout]', '-c:v', 'libx264', '-preset', 'ultrafast',
      '-c:a', 'aac', 'edited.mp4',
    );
    const edited = decodeAudio('edited.mp4', 'edited.raw');
    assert.ok(Math.abs(edited.length / 48000 - 2.5) < 0.05);
    assert.ok(peak(edited, 0.1, 0.4) > 0.08);
    assert.ok(peak(edited, 1, 2) > 0.015 && peak(edited, 1, 2) < 0.06);

    run('-i', 'source.mp4', '-map', '0:v:0', '-c:v', 'copy', '-an', 'silent.mp4');
    run(
      '-i', 'silent.mp4', '-i', 'source.mp4',
      '-filter_complex', buildStitchFilter(64, 48, [
        { duration: 4, hasAudio: false },
        { duration: 4, hasAudio: true },
      ]),
      '-map', '[outv]', '-map', '[outa]', '-c:v', 'libx264', '-preset', 'ultrafast',
      '-c:a', 'aac', 'stitched.mp4',
    );
    const stitched = decodeAudio('stitched.mp4', 'stitched.raw');
    assert.ok(Math.abs(stitched.length / 48000 - 8) < 0.05);
    assert.ok(peak(stitched, 1, 3) < 0.001);
    assert.ok(peak(stitched, 4.5, 5.5) > 0.08);

    const mixedCrops = normalizeEditRecipe({
      segments: [
        { startTime: 0, endTime: 1, playbackRate: 1, crop: { x: 0.125, y: 0, width: 0.75, height: 1 } },
        { startTime: 2, endTime: 3, playbackRate: 1, crop: { x: 0, y: 0.25, width: 1, height: 0.5 } },
      ],
      rotation: 0,
      crop: { x: 0, y: 0, width: 1, height: 1 },
    }, 4);
    run(
      '-i', 'source.mp4', '-filter_complex', buildMp4Filter(mixedCrops, true, false, true, { width: 64, height: 48 }),
      '-map', '[out]', '-map', '[aout]', '-c:v', 'libx264', '-preset', 'ultrafast',
      '-c:a', 'aac', 'mixed-crops.mp4',
    );
    run('-i', 'mixed-crops.mp4', '-map', '0:v:0', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'mixed-crops.raw');
    const pixels = core.FS.readFile('mixed-crops.raw');
    const frameBytes = 48 * 48 * 3;
    assert.equal(pixels.length, 60 * frameBytes);
    const pixel = (frame: number, x: number, y: number) => pixels.slice(frame * frameBytes + (y * 48 + x) * 3, frame * frameBytes + (y * 48 + x) * 3 + 3);
    assert.ok(pixel(45, 24, 2).every((channel) => channel < 10), 'second section has black padding');
    assert.ok(pixel(45, 24, 24).some((channel) => channel > 30), 'second section retains its image');
    assert.ok(peak(decodeAudio('mixed-crops.mp4', 'mixed-crops-audio.raw'), 1.25, 1.75) > 0.015);
  } finally {
    if (previousSelf) Object.defineProperty(globalThis, 'self', previousSelf);
    else Reflect.deleteProperty(globalThis, 'self');
  }
});
