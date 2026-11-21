import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createUI,pathPickerActions,pathPickerField} from '../../../src/client/ui.js';
import {english} from '../../../src/client/locale.js';

const React={createElement:(type:any,props:any,...children:any[])=>({type,props,children})};

test('field errors are associated with the editable control and never passed as input attributes',()=>{
  const ui=createUI(React,false,()=>{});
  const field=ui.field('Address','invalid',()=>{},'url',{id:'service-address',error:'Use an HTTP address','aria-describedby':'address-help'});
  const input=field.children[1],error=field.children[2];
  assert.equal(input.props['aria-invalid'],true);
  assert.equal(input.props['aria-describedby'],`address-help ${error.props.id}`);
  assert.equal(input.props.error,undefined);
  assert.equal(field.props.htmlFor,input.props.id);
  const valid=ui.field('Address','https://example.invalid',()=>{},'url',{id:'service-address'});
  assert.equal(valid.children[1].props['aria-invalid'],undefined);
  assert.equal(valid.children[2],null);
});

test('refreshing a selector preserves an unavailable saved value without choosing another option',()=>{
  let selected='removed';
  const select=createUI(React,false,()=>{},english).select('Model',selected,[{id:'available',name:'Available model'}],value=>{selected=value;}).children[1];
  assert.equal(select.props.value,'removed');
  assert.equal(select.children[0].props.value,'removed');
  assert.equal(select.children[0].props.disabled,true);
  assert.equal(select.children[0].children[0],'removed (unavailable)');
  assert.equal(selected,'removed');
});

test('a pending picker exposes an enabled cancel action while other picker actions remain usable',async()=>{
  let cancelled=0;
  const ui=createUI(React,false,()=>{});
  const pending=pathPickerActions(React.createElement,ui,english,{pending:true,onPick:()=>{},onCancel:()=>{cancelled++;}});
  assert.equal(pending.children[0].props.disabled,true);
  assert.equal(pending.children[1].props.disabled,false);
  pending.children[1].props.onClick();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(cancelled,1);
  assert.equal(pathPickerActions(React.createElement,ui,english,{pending:false,onPick:()=>{}}).children[0].props.disabled,false);
});

test('file and directory fields preserve editable drafts and associated errors while a chooser is pending',async()=>{
  for(const file of [false,true]){
    const calls:any[]=[];
    const ui=createUI(React,true,()=>{});
    const field=pathPickerField(React.createElement,ui,english,{id:'path',label:'Path',value:'C:/draft',pending:true,file,error:'Choose an accessible path',onChange:value=>calls.push(['draft',value]),onPick:()=>calls.push(['pick']),onCancel:()=>calls.push(['cancel'])});
    const input=field.children[0].children[1],actions=field.children[1].children;
    assert.equal(input.props.disabled,false);
    assert.equal(input.props['aria-describedby'],'path-error');
    input.props.onChange({target:{value:'C:/typed'}});
    assert.equal(actions[0].props.disabled,true);
    assert.equal(actions[0].props.type,'button');
    assert.equal(actions[1].props.disabled,false);
    actions[1].props.onClick();await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(calls,[['draft','C:/typed'],['cancel']]);
  }
});
