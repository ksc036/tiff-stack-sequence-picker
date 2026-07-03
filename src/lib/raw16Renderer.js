function clampByte(value) {
  return Math.min(255, Math.max(0, Math.round(value)));
}

export function mapRaw16ToRgba(pixels, min, max) {
  const output = new Uint8ClampedArray(pixels.length * 4);
  const range = Math.max(1, max - min);

  for (let index = 0; index < pixels.length; index += 1) {
    const gray = clampByte(((pixels[index] - min) / range) * 255);
    const target = index * 4;
    output[target] = gray;
    output[target + 1] = gray;
    output[target + 2] = gray;
    output[target + 3] = 255;
  }

  return output;
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) return null;

  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }

  return shader;
}

function createProgram(gl) {
  const vertexShader = compileShader(
    gl,
    gl.VERTEX_SHADER,
    `#version 300 es
    in vec2 aPosition;
    out vec2 vTexCoord;

    void main() {
      vTexCoord = vec2((aPosition.x + 1.0) * 0.5, (1.0 - aPosition.y) * 0.5);
      gl_Position = vec4(aPosition, 0.0, 1.0);
    }`
  );
  const fragmentShader = compileShader(
    gl,
    gl.FRAGMENT_SHADER,
    `#version 300 es
    precision highp float;
    precision highp usampler2D;

    uniform usampler2D uTexture;
    uniform float uMin;
    uniform float uMax;
    in vec2 vTexCoord;
    out vec4 outColor;

    void main() {
      float value = float(texture(uTexture, vTexCoord).r);
      float gray = clamp((value - uMin) / max(uMax - uMin, 1.0), 0.0, 1.0);
      outColor = vec4(gray, gray, gray, 1.0);
    }`
  );

  if (!vertexShader || !fragmentShader) return null;

  const program = gl.createProgram();
  if (!program) return null;

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }

  return program;
}

function renderWithWebgl2(canvas, pixels, width, height, min, max) {
  const gl = canvas.getContext("webgl2", {
    antialias: false,
    depth: false,
    preserveDrawingBuffer: true,
    premultipliedAlpha: false
  });

  if (!gl) return false;

  const program = createProgram(gl);
  if (!program) return false;

  const positionLocation = gl.getAttribLocation(program, "aPosition");
  const textureLocation = gl.getUniformLocation(program, "uTexture");
  const minLocation = gl.getUniformLocation(program, "uMin");
  const maxLocation = gl.getUniformLocation(program, "uMax");
  const positionBuffer = gl.createBuffer();
  const texture = gl.createTexture();

  if (positionLocation < 0 || !positionBuffer || !texture) {
    gl.deleteProgram(program);
    return false;
  }

  gl.viewport(0, 0, width, height);
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16UI, width, height, 0, gl.RED_INTEGER, gl.UNSIGNED_SHORT, pixels);

  gl.uniform1i(textureLocation, 0);
  gl.uniform1f(minLocation, min);
  gl.uniform1f(maxLocation, max);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  gl.deleteTexture(texture);
  gl.deleteBuffer(positionBuffer);
  gl.deleteProgram(program);
  return true;
}

function renderWith2d(canvas, pixels, width, height, min, max) {
  const context = canvas.getContext("2d");
  if (!context) return false;

  const imageData = context.createImageData(width, height);
  imageData.data.set(mapRaw16ToRgba(pixels, min, max));
  context.putImageData(imageData, 0, 0);
  return true;
}

export function renderRaw16ToCanvas(canvas, { pixels, width, height, min, max }) {
  if (!canvas || !pixels || !width || !height) return "none";

  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;

  if (renderWithWebgl2(canvas, pixels, width, height, min, max)) return "webgl2";
  return renderWith2d(canvas, pixels, width, height, min, max) ? "2d" : "none";
}
