// Prismarine's mineflayer helper does not return its HTTP server or expose listen
// errors, and overwrites bot.viewer for each camera. Use its same WorldView and
// routes with an awaitable lifecycle for each independent recorder camera.
const {EventEmitter} = require('node:events');
const http = require('node:http');
const express = require('express');
const {Server} = require('socket.io');
const {WorldView} = require('prismarine-viewer/viewer');
const {setupRoutes} = require('prismarine-viewer/lib/common');
async function startViewer(bot, {port,firstPerson,viewDistance=6}) {
  const app=express();
  setupRoutes(app,'');
  const server=http.createServer(app);
  const io=new Server(server);
  const api=new EventEmitter();
  const primitives={};
  api.erase=id=>{delete primitives[id];io.emit('primitive',{id});};
  api.drawLine=(id,points,color=0xff0000)=>{primitives[id]={type:'line',id,points,color};io.emit('primitive',primitives[id]);};
  api.drawBoxGrid=(id,start,end,color='aqua')=>{primitives[id]={type:'boxgrid',id,start,end,color};io.emit('primitive',primitives[id]);};
  api.drawPoints=(id,points,color=0xff0000,size=5)=>{primitives[id]={type:'points',id,points,color,size};io.emit('primitive',primitives[id]);};
  io.on('connection',socket=>{
    socket.emit('version',bot.version);
    const world=new WorldView(bot.world,viewDistance,bot.entity.position,socket);
    world.init(bot.entity.position).catch(error=>console.error('Viewer terrain initialization:',error));
    world.on('blockClicked',(...args)=>api.emit('blockClicked',...args));
    for(const primitive of Object.values(primitives))socket.emit('primitive',primitive);
    const move=()=>{
      const packet={pos:bot.entity.position,yaw:bot.entity.yaw,addMesh:true};
      if(firstPerson)packet.pitch=bot.entity.pitch;
      socket.emit('position',packet);
      world.updatePosition(bot.entity.position).catch(error=>console.error('Viewer terrain update:',error));
    };
    bot.on('move',move);world.listenToBot(bot);move();
    socket.on('disconnect',()=>{bot.removeListener('move',move);world.removeListenersFromBot(bot);});
  });
  try {
    await new Promise((resolve,reject)=>{
      server.once('error',reject);
      server.listen(port,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});
    });
  } catch(error) {
    await new Promise(resolve=>io.close(resolve));
    throw error;
  }
  api.port=server.address().port;
  let closing;
  api.close=()=>closing??=(new Promise(resolve=>io.close(resolve)));
  return api;
}
module.exports={startViewer};
