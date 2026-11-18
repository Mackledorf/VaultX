import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import type { VideoEditRecipe } from '../types';
import { buildMp4Filter, buildMp4InputArgs, normalizeEditRecipe } from './recipe';

type TestCore = {
  exec: (...args: string[]) => void;
  ret: number;
  reset: () => void;
  setLogger: (callback: (event: { message: string }) => void) => void;
  FS: { readFile: (path: string) => Uint8Array };
};

test('exports differently framed sections at a shared aspect ratio without black bars', async () => {
  const previousSelf = Object.getOwnPropertyDescriptor(globalThis, 'self');
  Object.defineProperty(globalThis, 'self', { configurable: true, value: { location: { href: 'file:///ffmpeg-core.js' } } });
  try {
    const require = createRequire(import.meta.url);
    const createCore: (options: { wasmBinary: Buffer }) => Promise<TestCore> = require('@ffmpeg/core');
    const core = await createCore({ wasmBinary: readFileSync(require.resolve('@ffmpeg/core/wasm')) });
    const logs: string[] = [];
    core.setLogger(({ message }) => logs.push(message));
    const run = (...args: string[]) => {
      logs.length = 0;
      core.exec(...args);
      assert.equal(core.ret, 0, logs.slice(-15).join('\n'));
      core.reset();
    };
    run('-f', 'lavfi', '-i', 'color=red:size=128x72:rate=30:duration=2',
      '-c:v', 'libx264', '-preset', 'superfast', 'source.mp4');
    const recipe = normalizeEditRecipe({
      segments: [
        { startTime: 0, endTime: 1, playbackRate: 1, crop: { x: 0, y: 0, width: 0.75, height: 0.75 } },
        { startTime: 1, endTime: 2, playbackRate: 1, crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 } },
      ],
      rotation: 0,
      crop: { x: 0, y: 0, width: 1, height: 1 },
      adjustments: {},
    }, 2);
    run('-i', 'source.mp4', '-filter_complex', buildMp4Filter(recipe, false, false, true, { width: 128, height: 72 }),
      '-map', '[out]', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'frames.rgb');
    const pixels = core.FS.readFile('frames.rgb');
    assert.equal(pixels.length, 96 * 54 * 3 * 60);
    for (let index = 0; index < pixels.length; index += 3) {
      assert.ok(pixels[index] > 180, 'Export contains a dark border or frame');
    }
  } finally {
    if (previousSelf) Object.defineProperty(globalThis, 'self', previousSelf);
    else Reflect.deleteProperty(globalThis, 'self');
  }
});

test('seeked exports preserve edited frames and audio while decoding less of the source', async () => {
  const previousSelf = Object.getOwnPropertyDescriptor(globalThis, 'self');
  Object.defineProperty(globalThis, 'self', {
    configurable: true,
    value: { location: { href: 'file:///ffmpeg-core.js' } },
  });
  try {
    const require = createRequire(import.meta.url);
    const createCore: (options: { wasmBinary: Buffer }) => Promise<TestCore> = require('@ffmpeg/core');
    const core = await createCore({ wasmBinary: readFileSync(require.resolve('@ffmpeg/core/wasm')) });
    const logs: string[] = [];
    core.setLogger(({ message }) => logs.push(message));
    const run = (...args: string[]) => {
      logs.length = 0;
      core.exec(...args);
      assert.equal(core.ret, 0, logs.slice(-15).join('\n'));
      core.reset();
      return [...logs];
    };
    const read = (path: string) => Buffer.from(core.FS.readFile(path));

    run(
      '-f', 'lavfi', '-i', 'testsrc2=size=128x72:rate=30000/1001:duration=20',
      '-f', 'lavfi', '-i', 'anoisesrc=sample_rate=44100:duration=20:seed=123',
      '-c:v', 'libx264', '-g', '90', '-preset', 'superfast', '-c:a', 'aac',
      '-output_ts_offset', '5', 'source.mp4',
    );
    const recipe = normalizeEditRecipe({
      segments: [{ startTime: 16.053, endTime: 18.297, playbackRate: 0.7 }],
      rotation: 90,
      crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
      adjustments: { brightness: 20, contrast: 10, denoise: 30, sharpness: 20 },
    }, 20);
    const outputOptions = [
      '-map', '[out]', '-map', '[aout]', '-c:v', 'libx264', '-preset', 'superfast',
      '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
    ];
    const baselineLogs = run(
      '-loglevel', 'verbose', '-i', 'source.mp4', '-filter_complex', buildMp4Filter(recipe, true),
      ...outputOptions, 'baseline.mp4',
    );
    const seekLogs = run(
      '-loglevel', 'verbose', ...buildMp4InputArgs(recipe, 'source.mp4'),
      '-filter_complex', buildMp4Filter(recipe, true, true), ...outputOptions, 'seeked.mp4',
    );
    const decodedFrames = (messages: string[]) => {
      const line = messages.find((message) => /Input stream #0:0 \(video\):/.test(message));
      const match = line?.match(/(\d+) frames decoded/);
      assert.ok(match, 'FFmpeg did not report decoded video frames');
      return Number(match[1]);
    };
    assert.ok(decodedFrames(seekLogs) < decodedFrames(baselineLogs) / 2);
    for (const name of ['baseline', 'seeked']) {
      run('-i', `${name}.mp4`, '-map', '0:v:0', '-pix_fmt', 'yuv420p', '-f', 'rawvideo', `${name}.yuv`);
      run('-i', `${name}.mp4`, '-map', '0:a:0', '-ac', '1', '-ar', '48000', '-c:a', 'pcm_f32le', '-f', 'f32le', `${name}.pcm`);
    }
    assert.ok(read('seeked.yuv').equals(read('baseline.yuv')), 'Encoded video differs from the baseline');
    assert.ok(read('seeked.pcm').equals(read('baseline.pcm')), 'Encoded audio differs from the baseline');

    const multi: VideoEditRecipe = {
      ...recipe,
      segments: [
        { startTime: 0.3, endTime: 1.4, playbackRate: 1.5 },
        { startTime: 12.137, endTime: 13.281, playbackRate: 0.7 },
        { startTime: 16.053, endTime: 17.297, playbackRate: 1 },
      ],
    };
    const renderRaw = (edit: VideoEditRecipe, mode: 'reference' | 'seeked' | 'fallback', name: string, audio: boolean, source = 'source.mp4') => {
      const input = mode === 'reference' ? ['-i', source] : buildMp4InputArgs(edit, source, mode === 'seeked');
      const filter = buildMp4Filter(edit, audio, mode !== 'reference', mode === 'seeked') + (audio ? ';[out]nullsink' : '');
      run(
        ...input, '-filter_complex', filter, '-map', audio ? '[aout]' : '[out]',
        ...(audio
          ? ['-ac', '1', '-ar', '48000', '-c:a', 'pcm_f32le', '-f', 'f32le']
          : ['-pix_fmt', 'yuv420p', '-fps_mode', 'passthrough', '-f', 'rawvideo']),
        name,
      );
      return read(name);
    };
    for (const audio of [false, true]) {
      const expected = Buffer.concat(multi.segments.map((segment, index) => (
        renderRaw({ ...multi, segments: [segment] }, 'reference', `reference-${audio}-${index}.raw`, audio)
      )));
      const actual = renderRaw(multi, 'seeked', `multi-${audio}.raw`, audio);
      assert.ok(actual.equals(expected), `Seeked multi-section ${audio ? 'audio' : 'video'} differs`);
      assert.ok(renderRaw(multi, 'fallback', `fallback-${audio}.raw`, audio).equals(expected), 'Fallback output differs');
    }
    const multiLogs = run(
      '-loglevel', 'verbose', ...buildMp4InputArgs(multi, 'source.mp4'),
      '-filter_complex', buildMp4Filter(multi, false, true), '-map', '[out]', '-f', 'null', '-',
    );
    const multiDecoded = multiLogs.flatMap((message) => {
      const match = message.match(/Input stream #\d+:0 \(video\):.*?(\d+) frames decoded/);
      return match ? [Number(match[1])] : [];
    });
    assert.equal(multiDecoded.length, multi.segments.length);
    assert.ok(multiDecoded.reduce((sum, frames) => sum + frames, 0) < decodedFrames(baselineLogs));

    run(
      '-i', 'source.mp4', '-vf', "select='not(eq(mod(n,5),0))'", '-fps_mode', 'vfr',
      '-an', '-c:v', 'libvpx', '-deadline', 'realtime', 'variable.webm',
    );
    const expectedVfr = renderRaw(recipe, 'reference', 'reference-vfr.raw', false, 'variable.webm');
    const seekedVfr = renderRaw(recipe, 'seeked', 'seeked-vfr.raw', false, 'variable.webm');
    assert.ok(seekedVfr.equals(expectedVfr), 'Variable-frame-rate video differs');

    run(
      '-f', 'lavfi', '-i', 'testsrc2=size=128x72:rate=30:duration=8',
      '-itsoffset', '2', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=6',
      '-c:v', 'libx264', '-g', '90', '-preset', 'superfast', '-c:a', 'aac', 'delayed.mov',
    );
    for (const [index, segment] of [
      { startTime: 0.3, endTime: 1.4, playbackRate: 1 },
      { startTime: 5.1, endTime: 6.3, playbackRate: 1 },
    ].entries()) {
      const edit = { ...recipe, segments: [segment] };
      const reference = renderRaw(edit, 'reference', `delayed-reference-${index}.pcm`, true, 'delayed.mov');
      const seeked = renderRaw(edit, 'seeked', `delayed-seeked-${index}.pcm`, true, 'delayed.mov');
      const a = new Float32Array(reference.buffer, reference.byteOffset, reference.byteLength / 4);
      const b = new Float32Array(seeked.buffer, seeked.byteOffset, seeked.byteLength / 4);
      assert.equal(b.length, a.length);
      let squaredError = 0;
      for (let i = 0; i < a.length; i++) squaredError += (a[i] - b[i]) ** 2;
      assert.ok(Math.sqrt(squaredError / a.length) < 0.00001, `Delayed audio differs in case ${index}`);
    }
  } finally {
    if (previousSelf) Object.defineProperty(globalThis, 'self', previousSelf);
    else Reflect.deleteProperty(globalThis, 'self');
  }
});
