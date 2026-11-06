import test from 'node:test';
import assert from 'node:assert/strict';
import { PhotonImage } from '@silvia-odwyer/photon-node';
import { collectPiImages, selectPiImages } from './pi-extension-images.mjs';

function image(pixels) {
  const decoded = new PhotonImage(new Uint8Array(pixels), 2, 2);
  try {return {type:'image',mimeType:'image/png',data:Buffer.from(decoded.get_bytes()).toString('base64')};}
  finally {decoded.free();}
}
test('blank and transparent images cannot substantiate a capture', () => {
  for (const pixel of [[255,255,255,255],[0,0,0,0]]) {
    const observed=collectPiImages([image(Array(4).fill(pixel).flat())]);
    assert.equal(selectPiImages(observed,[observed[0].id],'image').length,1);
    assert.throws(()=>selectPiImages(observed,[observed[0].id],'screenshot'), /blank|transparent/i);
  }
});
test('decodes output images, deduplicates, and rejects corrupt or excessive output', () => {
  const valid=image([255,0,0,255,0,255,0,255,0,0,255,255,0,0,0,255]);
  assert.equal(collectPiImages([valid,valid]).length,1);
  assert.throws(()=>collectPiImages([{...valid,data:'broken'}]),/decode|invalid/i);
  assert.throws(()=>collectPiImages([{...valid,data:'A'.repeat(12*1024*1024)}]),/limit/i);
});

test('observation cache evicts old frames without failing a long computer-use task',()=>{
 let frames=[];
 for(let i=0;i<12;i++) frames=collectPiImages([image([i,0,0,255,0,255,0,255,0,0,255,255,0,0,0,255])],frames);
 assert.equal(frames.length,8);
});
test('valid uniform images are decoded without being treated as corrupt files',()=>{
 assert.equal(collectPiImages([image(Array(4).fill([255,0,0,255]).flat())]).length,1);
});

test('only explicitly selected observations become deliverables',()=>{const frames=collectPiImages([image([255,0,0,255,0,255,0,255,0,0,255,255,0,0,0,255]),image([100,0,0,255,0,255,0,255,0,0,255,255,0,0,0,255])]);assert.deepEqual(selectPiImages(frames,[frames[1].id]).map(frame=>frame.id),[frames[1].id]);assert.throws(()=>selectPiImages(frames,['expired']),/no longer/);});
