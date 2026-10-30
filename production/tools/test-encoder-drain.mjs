import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough} from 'node:stream';
import {waitForEncoderDrain} from './encoder.mjs';
function blocked(){const stream=new PassThrough({highWaterMark:1});assert.equal(stream.write(Buffer.alloc(16)),false);return stream;}
function clean(stream){for(const event of ['drain','close','error'])assert.equal(stream.listenerCount(event),0);stream.destroy();}
test('encoder backpressure resumes and releases wait listeners',async()=>{
 const stream=blocked(),waiting=waitForEncoderDrain(stream);stream.resume();await waiting;clean(stream);
});
test('closed FFmpeg input rejects instead of waiting forever for drain',async()=>{
 const stream=blocked(),waiting=waitForEncoderDrain(stream);stream.destroy();await assert.rejects(waiting,/input closed/);clean(stream);
});
test('stalled FFmpeg input times out and releases wait listeners',async()=>{
 const stream=blocked();await assert.rejects(waitForEncoderDrain(stream,10),/input stalled/);clean(stream);
});
