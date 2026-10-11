import wgsl, { entryPoints, reflection } from './scene.slang';

const canvas = document.querySelector('#canvas');
const message = document.querySelector('#message');
const source = document.querySelector('#source');
source.href = URL.createObjectURL(new Blob([wgsl], { type: 'text/plain' }));

const entry = stage => entryPoints.find(e => e.stage === stage);
const binding = name => reflection.parameters.find(p => p.name === name).binding.index;
const globals = reflection.globalScope;
const uniforms = globals.parameters.filter(p => p.binding.kind === 'uniform');
const uniform = name => uniforms.find(p => p.name === name).binding;
const globalsSize = Math.ceil(Math.max(...uniforms.map(p => p.binding.offset + p.binding.size)) / 16) * 16;

async function main() {
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) {
    message.textContent = 'WebGPU is not available in this browser.';
    return;
  }

  const device = await adapter.requestDevice();
  const context = canvas.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });

  const module = device.createShaderModule({ code: wgsl });
  const render = device.createComputePipeline({
    layout: 'auto',
    compute: { module, entryPoint: entry('compute').name },
  });
  const present = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module, entryPoint: entry('vertex').name },
    fragment: { module, entryPoint: entry('fragment').name, targets: [{ format }] },
  });

  const globalsData = new ArrayBuffer(globalsSize);
  const resolution = new Float32Array(globalsData, uniform('resolution').offset, 2);
  const time = new Float32Array(globalsData, uniform('time').offset, 1);
  const globalsBuffer = device.createBuffer({
    size: globalsSize,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

  let image;
  let renderGroup;
  let presentGroup;

  function resize() {
    const scale = Math.min(devicePixelRatio, 1.5);
    const width = Math.max(1, Math.round(canvas.clientWidth * scale));
    const height = Math.max(1, Math.round(canvas.clientHeight * scale));
    if (image && width === canvas.width && height === canvas.height) return;

    canvas.width = width;
    canvas.height = height;
    image?.destroy();
    image = device.createTexture({
      size: [width, height],
      format: 'rgba16float',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    });
    const view = image.createView();

    renderGroup = device.createBindGroup({
      layout: render.getBindGroupLayout(0),
      entries: [
        { binding: globals.binding.index, resource: { buffer: globalsBuffer } },
        { binding: binding('target'), resource: view },
      ],
    });
    presentGroup = device.createBindGroup({
      layout: present.getBindGroupLayout(0),
      entries: [
        { binding: binding('image'), resource: view },
        { binding: binding('imageSampler'), resource: sampler },
      ],
    });
  }

  addEventListener('resize', resize);
  resize();

  const [x, y] = entry('compute').workgroupSize;

  requestAnimationFrame(function frame(now) {
    resolution.set([canvas.width, canvas.height]);
    time[0] = now / 1000;
    device.queue.writeBuffer(globalsBuffer, 0, globalsData);

    const encoder = device.createCommandEncoder();

    const compute = encoder.beginComputePass();
    compute.setPipeline(render);
    compute.setBindGroup(0, renderGroup);
    compute.dispatchWorkgroups(Math.ceil(canvas.width / x), Math.ceil(canvas.height / y));
    compute.end();

    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store' }],
    });
    pass.setPipeline(present);
    pass.setBindGroup(0, presentGroup);
    pass.draw(3);
    pass.end();

    device.queue.submit([encoder.finish()]);
    requestAnimationFrame(frame);
  });
}

main();
