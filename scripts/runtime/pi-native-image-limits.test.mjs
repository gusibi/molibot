import test from 'node:test';
import assert from 'node:assert/strict';
import { PhotonImage } from '@silvia-odwyer/photon-node';
import { resizeImage } from '@earendil-works/pi-coding-agent';
import { NATIVE_IMAGE_RESIZE, limitNativeImageContext, withNativeImageLimits } from './pi-native-image-limits.mjs';

function noisyPng(width, height) {
  const pixels = new Uint8Array(width * height * 4);
  let seed = 1;
  for (let i = 0; i < pixels.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    pixels[i] = seed & 255;
  }
  const image = new PhotonImage(pixels, width, height);
  try { return { bytes: image.get_bytes(), width, height }; }
  finally { image.free(); }
}

test('native image limits are applied without mutating the model', () => {
  const model = { id: 'fixture', provider: 'fixture', inputLimits: { maxRequestBytes: 1234 } };
  const limited = withNativeImageLimits(model);
  assert.notEqual(limited, model);
  assert.equal(model.inputLimits.images, undefined);
  assert.equal(limited.inputLimits.maxRequestBytes, 1234);
  assert.deepEqual(limited.inputLimits.images.resize, NATIVE_IMAGE_RESIZE);
});

test('a stricter provider limit is preserved', () => {
  const limited = withNativeImageLimits({ id: 'fixture', provider: 'fixture',
    inputLimits: { images: { resize: { maxWidth: 1024, maxHeight: 1024, maxBytes: 200 * 1024 } } } });
  assert.deepEqual(limited.inputLimits.images.resize, {
    maxWidth: 1024,
    maxHeight: 1024,
    maxBytes: 200 * 1024,
    jpegQuality: NATIVE_IMAGE_RESIZE.jpegQuality
  });
});

test('only the newest images that fit the request budget reach the model', () => {
  const image = size => ({ type: 'image', mimeType: 'image/jpeg', data: 'A'.repeat(size) });
  const context = { systemPrompt: 'fixture', messages: [
    { role: 'user', content: [{ type: 'text', text: 'older' }] },
    { role: 'toolResult', content: [{ type: 'text', text: 'first' }, image(600 * 1024)] },
    { role: 'toolResult', content: [{ type: 'text', text: 'newest' }, image(600 * 1024)] }
  ] };
  const bounded = limitNativeImageContext(context, 800 * 1024);
  assert.notEqual(bounded, context);
  assert.equal(context.messages[1].content[1].type, 'image');
  assert.equal(bounded.messages[0], context.messages[0]);
  assert.equal(bounded.messages[1].content[1].type, 'text');
  assert.match(bounded.messages[1].content[1].text, /Earlier image omitted/);
  assert.equal(bounded.messages[2].content[1].type, 'image');
});

test('a large PNG is re-encoded as JPEG without shrinking its dimensions', async () => {
  const source = noisyPng(500, 500);
  const original = Math.ceil(source.bytes.byteLength / 3) * 4;
  assert.ok(original > NATIVE_IMAGE_RESIZE.maxBytes, `fixture PNG must exceed the byte budget: ${original}`);
  const resized = await resizeImage(source.bytes, 'image/png', NATIVE_IMAGE_RESIZE);
  assert.ok(resized);
  assert.equal(resized.mimeType, 'image/jpeg');
  assert.equal(resized.width, source.width);
  assert.equal(resized.height, source.height);
  assert.ok(resized.data.length <= NATIVE_IMAGE_RESIZE.maxBytes, `JPEG base64 ${resized.data.length}`);
});
