import { getColorTransform } from './recipe';

const VERTEX_SHADER = `
attribute vec2 position;
varying vec2 uv;
void main() {
  uv = (position + 1.0) * 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

const COLOR_SHADER = `
precision highp float;
varying vec2 uv;
uniform sampler2D image;
uniform vec2 pixel;
uniform float brightness;
uniform float contrast;
uniform float inverseGamma;
uniform vec3 curve;
uniform float saturation;
uniform float denoise;

float tone(float value) {
  float x = pow(clamp((value - 0.5) * contrast + 0.5 + brightness, 0.0, 1.0), inverseGamma);
  if (x < 0.25) return x * curve.x * 4.0;
  if (x < 0.5) return curve.x + (x - 0.25) * (curve.y - curve.x) * 4.0;
  if (x < 0.75) return curve.y + (x - 0.5) * (curve.z - curve.y) * 4.0;
  return curve.z + (x - 0.75) * (1.0 - curve.z) * 4.0;
}

void main() {
  vec3 color = texture2D(image, uv).rgb;
  if (denoise > 0.0) {
    vec3 sum = color * 4.0;
    float total = 4.0;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        if (x != 0 || y != 0) {
          vec3 sampleColor = texture2D(image, uv + vec2(float(x), float(y)) * pixel).rgb;
          float difference = length(sampleColor - color);
          float weight = exp(-difference * difference / max(0.0001, denoise * denoise));
          sum += sampleColor * weight;
          total += weight;
        }
      }
    }
    color = sum / total;
  }
  // Approximate the browser's HD display conversion around FFmpeg's RGB/YUV filters.
  float sourceLuma = dot(color, vec3(0.2126, 0.7152, 0.0722));
  float sourceU = (color.b - sourceLuma) / 1.8556;
  float sourceV = (color.r - sourceLuma) / 1.5748;
  color = clamp(vec3(
    sourceLuma + 1.402 * sourceV,
    sourceLuma - 0.344136 * sourceU - 0.714136 * sourceV,
    sourceLuma + 1.772 * sourceU
  ), 0.0, 1.0);
  color = vec3(tone(color.r), tone(color.g), tone(color.b));
  float luma = dot(color, vec3(0.299, 0.587, 0.114));
  float chromaU = clamp((color.b - luma) / 1.772 * saturation, -0.5714, 0.567);
  float chromaV = clamp((color.r - luma) / 1.402 * saturation, -0.5714, 0.567);
  vec3 displayColor = vec3(
    luma + 1.5748 * chromaV,
    luma - 0.187324 * chromaU - 0.468124 * chromaV,
    luma + 1.8556 * chromaU
  );
  gl_FragColor = vec4(clamp(displayColor, 0.0, 1.0), 1.0);
}`;

const BLUR_SHADER = `
precision highp float;
varying vec2 uv;
uniform sampler2D image;
uniform vec2 pixel;
uniform float radius;
void main() {
  vec3 color;
  if (radius < 3.0) {
    color = texture2D(image, uv - 2.0 * pixel).rgb
      + 4.0 * texture2D(image, uv - pixel).rgb
      + 6.0 * texture2D(image, uv).rgb
      + 4.0 * texture2D(image, uv + pixel).rgb
      + texture2D(image, uv + 2.0 * pixel).rgb;
    color /= 16.0;
  } else {
    color = texture2D(image, uv - 3.0 * pixel).rgb
      + 6.0 * texture2D(image, uv - 2.0 * pixel).rgb
      + 15.0 * texture2D(image, uv - pixel).rgb
      + 20.0 * texture2D(image, uv).rgb
      + 15.0 * texture2D(image, uv + pixel).rgb
      + 6.0 * texture2D(image, uv + 2.0 * pixel).rgb
      + texture2D(image, uv + 3.0 * pixel).rgb;
    color /= 64.0;
  }
  gl_FragColor = vec4(color, 1.0);
}`;

const SHARPEN_SHADER = `
precision highp float;
varying vec2 uv;
uniform sampler2D image;
uniform sampler2D horizontalBlur;
uniform vec2 pixel;
uniform float radius;
uniform float amount;
void main() {
  vec3 blurred;
  if (radius < 3.0) {
    blurred = texture2D(horizontalBlur, uv - 2.0 * pixel).rgb
      + 4.0 * texture2D(horizontalBlur, uv - pixel).rgb
      + 6.0 * texture2D(horizontalBlur, uv).rgb
      + 4.0 * texture2D(horizontalBlur, uv + pixel).rgb
      + texture2D(horizontalBlur, uv + 2.0 * pixel).rgb;
    blurred /= 16.0;
  } else {
    blurred = texture2D(horizontalBlur, uv - 3.0 * pixel).rgb
      + 6.0 * texture2D(horizontalBlur, uv - 2.0 * pixel).rgb
      + 15.0 * texture2D(horizontalBlur, uv - pixel).rgb
      + 20.0 * texture2D(horizontalBlur, uv).rgb
      + 15.0 * texture2D(horizontalBlur, uv + pixel).rgb
      + 6.0 * texture2D(horizontalBlur, uv + 2.0 * pixel).rgb
      + texture2D(horizontalBlur, uv + 3.0 * pixel).rgb;
    blurred /= 64.0;
  }
  vec3 original = texture2D(image, uv).rgb;
  float detail = dot(original - blurred, vec3(0.299, 0.587, 0.114));
  gl_FragColor = vec4(clamp(original + amount * detail, 0.0, 1.0), 1.0);
}`;

type Surface = { texture: WebGLTexture; framebuffer: WebGLFramebuffer };

export function createLivePreview(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext('webgl', { alpha: false, preserveDrawingBuffer: true });
  if (!gl) throw new Error('WebGL is unavailable.');

  function program(fragmentSource: string) {
    const compile = (type: number, source: string) => {
      const shader = gl!.createShader(type);
      if (!shader) throw new Error('Could not create a preview shader.');
      gl!.shaderSource(shader, source);
      gl!.compileShader(shader);
      if (!gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) {
        const message = gl!.getShaderInfoLog(shader);
        gl!.deleteShader(shader);
        throw new Error(`Could not compile a preview shader: ${message}`);
      }
      return shader;
    };
    const vertex = compile(gl!.VERTEX_SHADER, VERTEX_SHADER);
    const fragment = compile(gl!.FRAGMENT_SHADER, fragmentSource);
    const result = gl!.createProgram();
    if (!result) throw new Error('Could not create a preview program.');
    gl!.attachShader(result, vertex);
    gl!.attachShader(result, fragment);
    gl!.linkProgram(result);
    gl!.deleteShader(vertex);
    gl!.deleteShader(fragment);
    if (!gl!.getProgramParameter(result, gl!.LINK_STATUS)) {
      const message = gl!.getProgramInfoLog(result);
      gl!.deleteProgram(result);
      throw new Error(`Could not link the preview program: ${message}`);
    }
    return result;
  }

  const colorProgram = program(COLOR_SHADER);
  const blurProgram = program(BLUR_SHADER);
  const sharpenProgram = program(SHARPEN_SHADER);
  const buffer = gl.createBuffer();
  if (!buffer) throw new Error('Could not create the preview buffer.');
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

  function texture() {
    const result = gl!.createTexture();
    if (!result) throw new Error('Could not create a preview texture.');
    gl!.bindTexture(gl!.TEXTURE_2D, result);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.LINEAR);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE);
    return result;
  }

  function surface(): Surface {
    const result = { texture: texture(), framebuffer: gl!.createFramebuffer() };
    if (!result.framebuffer) throw new Error('Could not create a preview framebuffer.');
    return { texture: result.texture, framebuffer: result.framebuffer };
  }

  const videoTexture = texture();
  const surfaces = [surface(), surface(), surface()];
  let surfaceWidth = 0;
  let surfaceHeight = 0;

  function resize(width: number, height: number) {
    if (surfaceWidth === width && surfaceHeight === height) return;
    canvas.width = width;
    canvas.height = height;
    surfaceWidth = width;
    surfaceHeight = height;
    for (const item of surfaces) {
      gl!.bindTexture(gl!.TEXTURE_2D, item.texture);
      gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, width, height, 0, gl!.RGBA, gl!.UNSIGNED_BYTE, null);
      gl!.bindFramebuffer(gl!.FRAMEBUFFER, item.framebuffer);
      gl!.framebufferTexture2D(gl!.FRAMEBUFFER, gl!.COLOR_ATTACHMENT0, gl!.TEXTURE_2D, item.texture, 0);
      if (gl!.checkFramebufferStatus(gl!.FRAMEBUFFER) !== gl!.FRAMEBUFFER_COMPLETE) {
        throw new Error('Could not initialize the preview framebuffer.');
      }
    }
  }

  function prepare(selected: WebGLProgram, target: Surface | null, input: WebGLTexture) {
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, target?.framebuffer ?? null);
    gl!.viewport(0, 0, surfaceWidth, surfaceHeight);
    gl!.useProgram(selected);
    gl!.bindBuffer(gl!.ARRAY_BUFFER, buffer);
    const location = gl!.getAttribLocation(selected, 'position');
    gl!.enableVertexAttribArray(location);
    gl!.vertexAttribPointer(location, 2, gl!.FLOAT, false, 0, 0);
    gl!.activeTexture(gl!.TEXTURE0);
    gl!.bindTexture(gl!.TEXTURE_2D, input);
    gl!.uniform1i(gl!.getUniformLocation(selected, 'image'), 0);
  }

  function sharpen(input: Surface, output: Surface | null, radius: number, amount: number, pixelX: number, pixelY: number) {
    prepare(blurProgram, surfaces[1], input.texture);
    gl!.uniform2f(gl!.getUniformLocation(blurProgram, 'pixel'), pixelX, 0);
    gl!.uniform1f(gl!.getUniformLocation(blurProgram, 'radius'), radius);
    gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4);
    prepare(sharpenProgram, output, input.texture);
    gl!.activeTexture(gl!.TEXTURE1);
    gl!.bindTexture(gl!.TEXTURE_2D, surfaces[1].texture);
    gl!.uniform1i(gl!.getUniformLocation(sharpenProgram, 'horizontalBlur'), 1);
    gl!.uniform2f(gl!.getUniformLocation(sharpenProgram, 'pixel'), 0, pixelY);
    gl!.uniform1f(gl!.getUniformLocation(sharpenProgram, 'radius'), radius);
    gl!.uniform1f(gl!.getUniformLocation(sharpenProgram, 'amount'), amount);
    gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4);
  }

  function draw(video: HTMLVideoElement, adjustments: Record<string, number>) {
    if (gl!.isContextLost()) throw new Error('The preview graphics context was lost.');
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight) return false;
    const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
    resize(Math.max(1, Math.round(video.videoWidth * scale)), Math.max(1, Math.round(video.videoHeight * scale)));
    gl!.activeTexture(gl!.TEXTURE0);
    gl!.bindTexture(gl!.TEXTURE_2D, videoTexture);
    gl!.pixelStorei(gl!.UNPACK_FLIP_Y_WEBGL, true);
    gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, gl!.RGBA, gl!.UNSIGNED_BYTE, video);
    const transform = getColorTransform(adjustments);
    const sharpness = Math.min(2, (adjustments.sharpness + adjustments.definition * 0.7) / 100);
    const clarity = adjustments.clarity / 100;
    const hasDetail = sharpness > 0 || clarity > 0;
    prepare(colorProgram, hasDetail ? surfaces[0] : null, videoTexture);
    gl!.uniform2f(gl!.getUniformLocation(colorProgram, 'pixel'), 1 / video.videoWidth, 1 / video.videoHeight);
    gl!.uniform1f(gl!.getUniformLocation(colorProgram, 'brightness'), transform.brightness);
    gl!.uniform1f(gl!.getUniformLocation(colorProgram, 'contrast'), transform.contrast);
    gl!.uniform1f(gl!.getUniformLocation(colorProgram, 'inverseGamma'), 1 / transform.gamma);
    gl!.uniform3f(gl!.getUniformLocation(colorProgram, 'curve'), transform.curvePoints[1][1], transform.curvePoints[2][1], transform.curvePoints[3][1]);
    gl!.uniform1f(gl!.getUniformLocation(colorProgram, 'saturation'), transform.saturation);
    gl!.uniform1f(gl!.getUniformLocation(colorProgram, 'denoise'), adjustments.denoise / 500);
    gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4);
    if (sharpness > 0) {
      sharpen(surfaces[0], clarity > 0 ? surfaces[2] : null, 2, sharpness, 1 / video.videoWidth, 1 / video.videoHeight);
    }
    if (clarity > 0) {
      sharpen(sharpness > 0 ? surfaces[2] : surfaces[0], null, 3, clarity, 1 / video.videoWidth, 1 / video.videoHeight);
    }
    return true;
  }

  return {
    draw,
    dispose() {
      gl!.deleteTexture(videoTexture);
      for (const item of surfaces) {
        gl!.deleteFramebuffer(item.framebuffer);
        gl!.deleteTexture(item.texture);
      }
      gl!.deleteBuffer(buffer);
      gl!.deleteProgram(colorProgram);
      gl!.deleteProgram(blurProgram);
      gl!.deleteProgram(sharpenProgram);
    },
  };
}
