// Small WebGL2 helpers for the valley renderer.
export type GL = WebGL2RenderingContext;

export function program(gl: GL, vs: string, fs: string) {
  const sh = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s) || "";
      const lines = src.split("\n").map((l, i) => `${i + 1}: ${l}`).join("\n");
      throw new Error(`Shader didn't compile: ${log}\n${lines.slice(0, 4000)}`);
    }
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`Shader didn't link: ${gl.getProgramInfoLog(p)}`);
  const uni = new Map<string, WebGLUniformLocation | null>();
  const u = (name: string) => { if (!uni.has(name)) uni.set(name, gl.getUniformLocation(p, name)); return uni.get(name)!; };
  return { p, u, attr: (name: string) => gl.getAttribLocation(p, name) };
}
export type Prog = ReturnType<typeof program>;

export function texture(gl: GL, w: number, h: number, o: { internal?: number; format?: number; type?: number; filter?: number; data?: ArrayBufferView | null; mip?: boolean } = {}) {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, o.internal ?? gl.RGBA8, w, h, 0, o.format ?? gl.RGBA, o.type ?? gl.UNSIGNED_BYTE, o.data ?? null);
  const f = o.filter ?? gl.LINEAR;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, o.mip ? gl.LINEAR_MIPMAP_LINEAR : f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (o.mip) gl.generateMipmap(gl.TEXTURE_2D);
  return t;
}

/** An image (bitmap) as a texture, with its bytes exactly as stored (no colour management, no premultiplying). */
export function imageTexture(gl: GL, img: TexImageSource, o: { filter?: number; mip?: boolean } = {}) {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
  const f = o.filter ?? gl.LINEAR;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, o.mip ? gl.LINEAR_MIPMAP_LINEAR : f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (o.mip) gl.generateMipmap(gl.TEXTURE_2D);
  return t;
}

export function target(gl: GL, w: number, h: number, float: boolean, internal?: number) {
  const tex = float
    ? texture(gl, w, h, { internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT })
    : texture(gl, w, h, { internal: internal ?? gl.RGBA8 });
  const fb = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  if (!ok) throw new Error("This graphics card can't draw the valley at this size.");
  return { tex, fb, w, h };
}
export type Target = ReturnType<typeof target>;

/** Buffers for instanced quads: a unit quad plus per-instance attributes (floats). */
export function instances(gl: GL, prog: Prog, layout: [string, number][], data: Float32Array) {
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  const quad = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  const c = prog.attr("aCorner");
  gl.enableVertexAttribArray(c);
  gl.vertexAttribPointer(c, 2, gl.FLOAT, false, 0, 0);
  const buf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  const stride = layout.reduce((s, [, n]) => s + n, 0) * 4;
  let off = 0;
  for (const [name, n] of layout) {
    const loc = prog.attr(name);
    if (loc >= 0) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, n, gl.FLOAT, false, stride, off);
      gl.vertexAttribDivisor(loc, 1);
    }
    off += n * 4;
  }
  gl.bindVertexArray(null);
  const count = data.length / (stride / 4);
  return { draw: () => { gl.bindVertexArray(vao); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count); gl.bindVertexArray(null); }, free: () => { gl.deleteBuffer(buf); gl.deleteBuffer(quad); gl.deleteVertexArray(vao); }, count };
}

/** A small deterministic random-number generator. */
export function rng(seed: number) {
  let a = seed >>> 0 || 1;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const hash01 = (n: number) => { const r = rng((n * 2654435761) >>> 0); r(); return r(); };
