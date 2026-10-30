import {test} from 'node:test';
import assert from 'node:assert/strict';
import {waitForMedia} from '../production/src/media-wait.js';
function fixture(){
 const media=Object.assign(new EventTarget(),{src:'http://localhost/camera.mp4',currentTime:3,readyState:0,seeking:false,error:null});
 return media;
}
test('media wait observes events emitted synchronously by a seek',async()=>{
 const media=fixture();let ready=false;
 await waitForMedia(media,'seek',()=>ready,()=>{ready=true;media.dispatchEvent(new Event('seeked'));},100);
});
test('media wait times out with source and seek state instead of hanging',async()=>{
 const media=fixture();
 await assert.rejects(waitForMedia(media,'seek to 3.000s',()=>false,undefined,10),/seek to 3.000s timed out.*camera.mp4 at 3.000s.*readyState=0/);
});
test('media wait reports decoder errors and removes listeners after settlement',async()=>{
 const media=fixture();let listeners=0;
 const add=media.addEventListener.bind(media),remove=media.removeEventListener.bind(media);
 media.addEventListener=(...args:Parameters<typeof add>)=>{listeners++;add(...args);};
 media.removeEventListener=(...args:Parameters<typeof remove>)=>{listeners--;remove(...args);};
 await assert.rejects(waitForMedia(media,'load',()=>false,()=>{
  Object.assign(media,{error:{message:'decoder unavailable'}});media.dispatchEvent(new Event('error'));
 }),/load failed.*decoder unavailable/);
 assert.equal(listeners,0);
});
