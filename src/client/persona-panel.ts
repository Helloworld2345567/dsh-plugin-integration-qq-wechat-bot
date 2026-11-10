import type {createUI} from './ui.js';
import type {Translate} from './locale.js';

export type PersonaEditorSection='basic'|'behavior'|'tools'|'media'|'files';

export interface PersonaPanelProps {
  h:any;
  ui:ReturnType<typeof createUI>;
  t:Translate;
  configs:any[];
  selected:any|null;
  existing:boolean;
  busy:boolean;
  configLoading:boolean;
  dirty:boolean;
  section:PersonaEditorSection;
  relatedBots:number;
  sections:Partial<Record<PersonaEditorSection,any>>;
  selectPersona:(id:string)=>unknown;
  createPersona:()=>unknown;
  copyPersona:()=>unknown;
  importPersona:()=>unknown;
  setSection:(section:PersonaEditorSection)=>unknown;
  save:()=>unknown;
  discard:()=>unknown;
}

export function personaPanel({h,ui,t,configs,selected,existing,busy,configLoading,dirty,section,relatedBots,sections,selectPersona,createPersona,copyPersona,importPersona,setSection,save,discard}:PersonaPanelProps){
  const listRows=configs.map(config=>h('button',{type:'button',key:config.id,className:`persona-list-row${selected?.id===config.id?' selected':''}`,disabled:busy||configLoading,onClick:()=>selectPersona(config.id)},h('strong',null,config.name),h('small',null,config.id),h('span',{className:'muted'},t('relatedBots',{count:config.relatedBots??0}))));
  const editorSections:[PersonaEditorSection,string][]=[['basic',t('basic')],['behavior',t('behavior')],['tools',t('capabilities')],['media',t('media')],['files',t('files')]];
  const toolbar=h('div',{className:'page-toolbar row spread'},
    h('div',null,h('h2',null,t('personas'))),
    h('div',{className:'actions'},
      ui.button(t('createNew'),createPersona,{className:'primary'}),
      ui.button(t('copy'),copyPersona,{disabled:busy||configLoading||!existing}),
      ui.button(t('import'),importPersona),
    ),
  );
  const list=h('aside',{className:'persona-list card'},
    ui.select(t('persona'),existing&&selected?selected.id:'',[{id:'',name:selected?t('newPersona'):t('select')},...configs.map(config=>({id:config.id,name:config.name}))],selectPersona,{disabled:busy||configLoading}),
    h('div',{className:'persona-list-rows'},...(listRows.length?listRows:[h('p',{className:'empty',key:'empty'},t('noPersonas'))])),
  );
  const editor=selected?h('section',{className:'persona-editor card'},
    h('div',{className:'persona-editor-header row spread'},
      h('div',null,h('h3',null,selected.name||t('newPersona')),
        h('div',{className:'persona-meta'},
          h('span',{className:`badge${dirty?' warning':''}`},dirty?t('unsaved'):t('savedState')),
          h('span',{className:'muted'},t('relatedBots',{count:relatedBots})),
        ),
      ),
    ),
    h('nav',{className:'persona-section-nav','aria-label':t('personaSections')},...editorSections.map(([id,label])=>ui.button(label,()=>setSection(id),{key:id,className:section===id?'selected':'','aria-current':section===id?'page':undefined,disabled:busy||configLoading}))),
    h('div',{className:'persona-section-content'},sections[section]??null),
    dirty?h('div',{className:'save-bar sticky'},h('span',null,t('unsaved')),h('div',{className:'actions'},ui.button(t('cancel'),discard),ui.button(t('save'),save,{className:'primary'}))):null,
  ):h('div',{className:'persona-editor card empty'},t('selectPersona'));
  return h('section',{className:'persona-page','aria-label':t('personas')},toolbar,h('div',{className:'persona-workspace'},list,editor));
}
