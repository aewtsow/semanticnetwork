'use strict';
// Exercise the actual modal lifecycle functions with a minimal DOM fixture.
// Responsive geometry and real pointer behavior are checked in the browser.
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const source=fs.readFileSync(__dirname+'/workbench.js','utf8');
const lifecycle=source.slice(source.indexOf('  function openExpanded(){'),source.indexOf('  function draw(){'));
assert.ok(lifecycle.includes('function closeExpanded()'));
function fixture(graph={center:1}){
  const classes=new Set(),state={graph,view:{x:23,y:-12,k:.7},hover:2,expanded:null};
  const elements={labels:{value:'all'},expandedLabels:{},graphPanel:{before(p){this.placeholder=p;}},
    expandNetwork:{isConnected:true,focus(){ctx.focus='expand';}},closeNetwork:{focus(){ctx.focus='close';}},
    networkDialog:{open:false,append(panel){panel.parent='dialog';},showModal(){this.open=true;},close(){this.open=false;}}};
  const ctx={state,$:id=>elements[id],document:{activeElement:elements.expandNetwork,
    body:{classList:{add:x=>classes.add(x),remove:x=>classes.delete(x)}},
    createComment:()=>({replaceWith(panel){panel.parent='workbench';}})},
    draw(){ctx.draws++;},stopMotion(){ctx.stops++;},fit(){ctx.fits++;state.view={x:0,y:0,k:1};},
    draws:0,stops:0,fits:0};
  vm.createContext(ctx);vm.runInContext(lifecycle,ctx);
  return {ctx,state,elements,classes};
}
{
  const {ctx,state,elements,classes}=fixture(),before={...state.view},graph=state.graph;
  ctx.openExpanded();assert.equal(elements.networkDialog.open,true);assert.equal(classes.has('network-expanded'),true);
  assert.equal(elements.graphPanel.parent,'dialog');assert.equal(elements.expandedLabels.value,'all');assert.equal(ctx.focus,'close');
  ctx.openExpanded();assert.equal(ctx.fits,1,'Repeated open must not replace the saved camera');
  state.view={x:90,y:20,k:2};ctx.closeExpanded();
  assert.deepEqual({...state.view},before);assert.equal(state.graph,graph);assert.equal(elements.graphPanel.parent,'workbench');
  assert.equal(elements.networkDialog.open,false);assert.equal(classes.size,0);assert.equal(ctx.focus,'expand');
  const draws=ctx.draws;ctx.closeExpanded();assert.equal(ctx.draws,draws,'Close event must be idempotent');
}
{
  const {ctx,state}=fixture();ctx.openExpanded();state.graph={center:2};ctx.closeExpanded();
  assert.equal(state.graph.center,2,'Closing must preserve a newly selected center');assert.equal(ctx.fits,2,'New graph fits the restored viewport');
}
{
  const {ctx,state}=fixture(null);ctx.openExpanded();state.graph={center:3};ctx.closeExpanded();
  assert.equal(state.graph.center,3,'Loading can complete while expanded');assert.equal(ctx.fits,2);
}
console.log('Expanded network passed: modal lifecycle, camera restoration, no graph replacement, reentry, recenter and loading cases.');
