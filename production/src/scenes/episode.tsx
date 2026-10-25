import {makeScene2D, Rect, Txt, Video} from '@motion-canvas/2d';
import {createRef, waitFor, all} from '@motion-canvas/core';
import plan from '../../generated/edit-plan.json';

type Camera = {id:string; file:string; offsetSeconds?:number};
type Shot = {kind:'full'|'split'|'pip'; cameras:string[]; start:number; duration:number; label?:string};
type Segment = {kind:'intro'|'shot'|'outro'; duration:number; text?:string; shot?:Shot};
const width=1920, height=1080;
const cameras = new Map((plan.cameras as Camera[]).map(c => [c.id, c]));
const cameraOffset = (camera:string) => cameras.get(camera)?.offsetSeconds??0;
const videoSrc = (camera:string) => {
  const config=cameras.get(camera);
  if (!config) throw new Error('Unknown camera '+camera);
  return '/media/'+config.file;
};

export default makeScene2D(function* (view) {
  view.fill('#0c1520');
  for (const segment of plan.segments as Segment[]) {
    const group=createRef<Rect>();
    view.add(<Rect ref={group} width={width} height={height} fill={'#0c1520'} opacity={0}/>);
    if(segment.kind==='shot' && segment.shot){
      const shot=segment.shot;
      const primary=createRef<Video>();
      const name=shot.cameras[0];
      const full=shot.kind==='full';
      const split=shot.kind==='split';
      group().add(<Video ref={primary} src={videoSrc(name)} width={split?width/2:width} height={height}
        x={split?-width/4:0} smoothing={false}/>);
      primary().seek(Math.max(0,shot.start+cameraOffset(name))); primary().play();
      if ((split || shot.kind==='pip') && shot.cameras[1]) {
        const secondary=createRef<Video>();
        const pip=shot.kind==='pip';
        group().add(<Video ref={secondary} src={videoSrc(shot.cameras[1])}
          width={pip?640:width/2} height={pip?360:height}
          x={pip?width/2-380:width/4} y={pip?-height/2+230:0}
          smoothing={false} lineWidth={pip?6:0} stroke={'#f4f0d4'}/>);
        secondary().seek(Math.max(0,shot.start+cameraOffset(shot.cameras[1]))); secondary().play();
      }
      if (shot.label) group().add(<Txt text={shot.label} fontSize={40} fill={'#ffffff'}
        fontFamily={'sans-serif'} y={height/2-70} shadowColor={'#000000'} shadowBlur={10}/>);
    } else {
      group().add(<Txt text={segment.kind==='intro'?'EMERGENT':'WHAT SHOULD WE TRY NEXT?'}
        y={-150} fontSize={78} fontFamily={'sans-serif'} fontWeight={800} fill={'#e7e8dc'}/>);
      group().add(<Txt text={segment.text??''} width={1500} textWrap fontSize={54}
        fontFamily={'sans-serif'} fill={'#a8d9e7'} textAlign={'center'}/>);
    }
    const fade=Math.min(0.35,segment.duration/5);
    yield* group().opacity(1,fade);
    yield* waitFor(Math.max(0,segment.duration-2*fade));
    yield* group().opacity(0,fade);
    group().remove();
  }
});
