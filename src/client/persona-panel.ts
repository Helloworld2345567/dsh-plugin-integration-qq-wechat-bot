import type {createUI} from './ui.js';
import type {Translate} from './locale.js';

export type PersonaEditorSection='basic'|'files';

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
  const listRows=configs.map(config=>ui.button([
    h('strong',{key:'name'},config.name),
    h('small',{key:'id'},config.id),
    h('span',{key:'bots',className:'muted'},t('relatedBots',{count:config.relatedBots??0})),
  ],()=>selectPersona(config.id),{key:config.id,className:`persona-list-row${selected?.id===config.id?' selected':''}`,disabled:busy||configLoading,'aria-label':config.name,'aria-pressed':selected?.id===config.id}));
  const editorSections:[PersonaEditorSection,string][]=[['basic',t('personaPrompt')],['files',t('files')]];
  const toolbar=h('div',{className:'page-toolbar row spread'},
    h('div',null,h('h2',null,t('personas'))),
    h('div',{className:'actions'},
      ui.button(t('copy'),copyPersona,{disabled:busy||configLoading||!existing}),
      ui.button(t('import'),importPersona),
    ),
  );
  const list=h('nav',{className:'persona-list entity-strip','aria-label':t('personas')},
    ...listRows,
    ui.button('＋',createPersona,{className:'entity-create','aria-label':t('newPersona'),title:t('newPersona'),disabled:busy||configLoading}),
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
    h('nav',{className:'persona-section-nav','aria-label':t('personaSections')},...editorSections.map(([id,label])=>ui.button(label,()=>setSection(id),{key:id,id:`persona-section-${id}`,className:section===id?'selected':'','aria-current':section===id?'page':undefined,'aria-controls':'persona-section-content',disabled:busy||configLoading}))),
    h('div',{className:'persona-section-content',id:'persona-section-content',role:'region','aria-labelledby':`persona-section-${section}`},configLoading?h('p',{role:'status'},t('loadingConfig')):sections[section]??null),
    dirty?h('div',{className:'save-bar sticky'},h('span',null,t('unsaved')),h('div',{className:'actions'},ui.button(t('cancel'),discard),ui.button(t('save'),save,{className:'primary'}))):null,
  ):h('div',{className:'persona-editor card empty'},t('selectPersona'));
  return h('section',{className:'persona-page','aria-label':t('personas')},toolbar,h('div',{className:'persona-workspace'},list,editor));
}
