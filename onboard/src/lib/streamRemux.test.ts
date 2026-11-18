import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { buildStreamRemuxArgs } from './streamRemux';

type TestCore = {
  exec: (...args: string[]) => void;
  ret: number;
  reset: () => void;
  setLogger: (callback: (event: { message: string }) => void) => void;
  FS: {
    readFile: (path: string) => Uint8Array;
    writeFile: (path: string, data: Uint8Array) => void;
  };
};

test('bundled FFmpeg remuxes fragmented HLS video and separate audio without changing decoded samples', async () => {
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
      core.exec('-y', ...args);
      assert.equal(core.ret, 0, logs.slice(-15).join('\n'));
      core.reset();
      return [...logs];
    };
    run('-f', 'lavfi', '-i', 'testsrc2=size=128x72:rate=10:duration=2',
      '-c:v', 'libx264', '-g', '10', '-output_ts_offset', '0.5', '-f', 'hls', '-hls_time', '1',
      '-hls_segment_type', 'fmp4', '-hls_fmp4_init_filename', 'vinit.mp4', 'video.m3u8');
    run('-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=2',
      '-c:a', 'aac', '-f', 'hls', '-hls_time', '1',
      '-hls_segment_type', 'fmp4', '-hls_fmp4_init_filename', 'ainit.mp4', 'audio.m3u8');
    const assemble = (playlist: string, init: string) => {
      const entries = new TextDecoder().decode(core.FS.readFile(playlist)).split('\n').filter((line) => line && !line.startsWith('#'));
      return Buffer.concat([init, ...entries].map((path) => Buffer.from(core.FS.readFile(path))));
    };
    core.FS.writeFile('video-input', assemble('video.m3u8', 'vinit.mp4'));
    core.FS.writeFile('audio-input', assemble('audio.m3u8', 'ainit.mp4'));
    run(...buildStreamRemuxArgs(true));
    const read = (path: string) => Buffer.from(core.FS.readFile(path));
    for (const [source, map, format, codec] of [
      ['video-input', '0:v:0', 'rawvideo', 'rawvideo'],
      ['audio-input', '0:a:0', 's16le', 'pcm_s16le'],
    ]) {
      run('-i', source, '-map', map, '-c', codec, '-f', format, 'source.raw');
      run('-i', 'output.mp4', '-map', map, '-c', codec, '-f', format, 'output.raw');
      assert.ok(read('source.raw').equals(read('output.raw')), `${map} changed during remuxing`);
    }
    const firstTimestamps = (input: string) => {
      const messages = run('-debug_ts', '-i', input, '-map', '0', '-c', 'copy', '-f', 'null', '-');
      const timestamps = new Map<number, number>();
      for (const message of messages) {
        const match = message.match(/demuxer -> ist_index:(\d+).*?pkt_pts_time:([-\d.]+)/);
        if (match && !timestamps.has(Number(match[1]))) timestamps.set(Number(match[1]), Number(match[2]));
      }
      return timestamps;
    };
    const videoTime = firstTimestamps('video-input').get(0);
    const audioTime = firstTimestamps('audio-input').get(0);
    const outputTimes = firstTimestamps('output.mp4');
    assert.ok(videoTime !== undefined && audioTime !== undefined);
    assert.ok(outputTimes.has(0) && outputTimes.has(1));
    assert.ok(Math.abs((outputTimes.get(0)! - outputTimes.get(1)!) - (videoTime - audioTime)) < 0.002, 'Audio/video start offset changed');
  } finally {
    if (previousSelf) Object.defineProperty(globalThis, 'self', previousSelf);
    else Reflect.deleteProperty(globalThis, 'self');
  }
});
