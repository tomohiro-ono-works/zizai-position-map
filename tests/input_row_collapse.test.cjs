const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(match => match[1]);

class Element {
  constructor(tag = 'div') {
    this.tagName = tag;
    this.children = [];
    this.handlers = {};
    this.attributes = {};
    this.value = '';
    this.className = '';
    this.textContent = '';
    this.hidden = false;
    this.style = {};
    this.scrollLeft = 0;
    this.scrollTop = 0;
    this.dataset = {};
    this.classList = {toggle: () => {}};
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name]; }
  addEventListener(name, fn) { this.handlers[name] = fn; }
  dispatch(name, details = {}) { this.handlers[name]?.({target: this, ...details}); }
  contains(target) { return this === target || this.children.some(child=>child.contains?.(target)); }
  querySelector(name) {
    if (name === '.table-wrap') return this.scrollArea;
    if (name === '.picker-options') return this.pickerOptions;
    if (name === 'summary') return this.summary;
    return null;
  }
  getBoundingClientRect() { return this.rect ?? {top: 100, bottom: 120, left: 100, right: 120, width: 20, height: 20}; }
  showPopover() { this.popoverOpen = true; }
  hidePopover() { this.popoverOpen = false; }
  querySelectorAll(selector) {
    if (selector !== 'textarea[data-autosize-detail="true"]') return [];
    const found = [];
    const walk = node => {
      if (node.tagName === 'textarea' && node.attributes['data-autosize-detail'] === 'true') found.push(node);
      for (const child of node.children ?? []) walk(child);
    };
    walk(this);
    return found;
  }
  get scrollHeight() { return this.tagName === 'textarea' ? 18 + Math.ceil(String(this.value).length / 20) * 18 : 0; }
}

function setup(useInitialSample = false, customSnapshot = null) {
  const elements = new Map();
  const navigation = {};
  const formatting = {};
  const analysisPickers = {};
  const getElement = id => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  getElement('table-input').scrollArea = new Element();
  for (const view of ['definition', 'input', 'analysis']) {
    navigation[view] = new Element('button');
    navigation[view].dataset.viewTab = view;
  }
  for (const format of ['table', 'yaml']) {
    formatting[format] = new Element('button');
    formatting[format].dataset.formatTab = format;
  }
  for (const key of ['rows','columns','values','filters','tooltip']) {
    const picker = new Element('details');
    picker.pickerOptions = new Element('div');
    picker.summary = new Element('summary');
    analysisPickers[key] = picker;
  }
  const columns = [
    {id: 'name', name: '案件名', type: 'text', cardinality: '1:1', options: []},
    {id: 'stage', name: '業務の上位工程', type: 'select', cardinality: '1:1', options: ['設計', '評価'], allowDetail: true, optionColors: {'設計': '#112233'}},
    {id: 'tech', name: '技術の高度化', type: 'multiselect', cardinality: '1:N', options: ['統計', '機械学習'], allowDetail: true, optionColors: {'統計': '#e3a4c5'}}
  ];
  const projects = [
    {id: 'p1', data: {name: '案件A', stage: '設計', tech: ['統計']}},
    {id: 'p2', data: {name: '案件B', stage: '評価', tech: ['機械学習']}}
  ];
  const storage = useInitialSample ? new Map() : new Map([['dx_three_screens_v2', JSON.stringify(customSnapshot ?? {detailUiVersion: 1, columns, projects})]]);
  const document = {
    handlers: {},
    addEventListener(name, fn) { this.handlers[name] = fn; },
    dispatch(name, details = {}) { this.handlers[name]?.({target: this, ...details}); },
    createElement: tag => new Element(tag),
    createTextNode: text => ({textContent: text}),
    getElementById: getElement,
    querySelector: selector => {
      const match = selector.match(/^\[data-view-tab="(.+)"\]$/);
      const formatMatch = selector.match(/^\[data-format-tab="(.+)"\]$/);
      const pickerMatch = selector.match(/^\[data-picker="(.+)"\]$/);
      return match ? navigation[match[1]] : formatMatch ? formatting[formatMatch[1]] : pickerMatch ? analysisPickers[pickerMatch[1]] : new Element();
    },
    querySelectorAll: selector => selector === '[data-view-tab]' ? Object.values(navigation) : selector === '[data-format-tab]' ? Object.values(formatting) : []
  };
  const context = {
    document,
    localStorage: {getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value)},
    structuredClone, Date, Math, JSON, Set, Map, console, window: {innerHeight: 680, innerWidth: 1200},
    setTimeout: () => 0, clearTimeout: () => {}, confirm: () => true
  };
  vm.runInNewContext(scripts.join('\n'), context);
  navigation.input.dispatch('click');
  const find = (node, predicate) => {
    if (predicate(node)) return node;
    for (const child of node.children ?? []) {
      const found = find(child, predicate);
      if (found) return found;
    }
    return null;
  };
  return {body: getElement('entry-body'), find, storage, navigation, formatting, analysisPickers, getElement, context};
}

test('formatting prompt copy is visible only in YAML mode on definition and input views', () => {
  const {formatting, navigation, getElement} = setup();
  const definitionButton = getElement('copy-definition-prompt');
  const definitionBar = getElement('definition-prompt-action-bar');
  const inputButton = getElement('copy-input-prompt');
  const inputBar = getElement('input-prompt-action-bar');
  assert.doesNotMatch(html, /id="load-five-axis-sample"/, 'sample-switch button is removed from the definition view');
  assert.doesNotMatch(html, /function loadFiveAxisSample\(/, 'unused sample-switch logic is removed');
  assert.equal(definitionButton.hidden, true, 'definition prompt is hidden in table mode');
  assert.equal(definitionBar.hidden, true, 'definition prompt bar leaves no empty space in table mode');
  assert.equal(inputButton.hidden, true, 'input prompt is hidden in table mode');
  assert.equal(inputBar.hidden, true, 'input prompt bar does not leave empty vertical space');
  formatting.yaml.dispatch('click');
  assert.equal(definitionButton.hidden, false);
  assert.equal(definitionBar.hidden, false);
  assert.equal(inputButton.hidden, false);
  assert.equal(inputBar.hidden, false);
  navigation.input.dispatch('click');
  assert.equal(inputButton.hidden, false, 'stays visible in input YAML view');
  formatting.table.dispatch('click');
  assert.equal(definitionButton.hidden, true);
  assert.equal(definitionBar.hidden, true);
  assert.equal(inputButton.hidden, true);
  assert.equal(inputBar.hidden, true);
});

test('definition formatting prompt prioritizes cleanup while adding justified missing fields and options', () => {
  const {context, storage} = setup(true);
  const columns = JSON.parse(storage.get('dx_three_screens_v2')).columns;
  const prompt = context.buildDefinitionFormattingPrompt(columns);
  assert.match(prompt, /整形を優先/);
  assert.match(prompt, /既存の項目.*維持/);
  assert.match(prompt, /不足する項目.*追加/);
  assert.match(prompt, /不足する選択候補.*追加/);
  assert.match(prompt, /重複.*追加しない/);
  assert.match(prompt, /根拠のない項目.*追加しない/);
  assert.doesNotMatch(prompt, /入力で明示された変更だけを反映する/, 'new fields are permitted when the input shows a need');
  assert.match(prompt, /description/);
  assert.match(prompt, /【現在の項目定義／出力構造】/);
  assert.match(prompt, /【入力内容】/);
});

test('input formatting prompt uses live field definitions as its classification guide for YAML', () => {
  const {context, storage} = setup(true);
  const columns = JSON.parse(storage.get('dx_three_screens_v2')).columns;
  columns[1].description = '案件が担う工程と意思決定までの距離を表します。';
  const prompt = context.buildFormattingPrompt(columns);
  assert.match(prompt, /【項目定義（分類基準・変更禁止）】/);
  assert.match(prompt, /description: "案件が担う工程と意思決定までの距離を表します。"/, 'latest description is copied into the prompt');
  assert.match(prompt, /type: multiselect/);
  assert.match(prompt, /cardinality: 1:1/);
  assert.match(prompt, /options: \[/);
  assert.match(prompt, /項目名と項目説明の意味を優先/);
  assert.match(prompt, /選択候補の中から/);
  assert.match(prompt, /項目定義にない項目.*追加しない/);
  assert.match(prompt, /根拠のない.*補完しない/);
  assert.match(prompt, /【出力構造】\nprojects:/);
  assert.match(prompt, /【入力内容】/);
});

test('analysis cell labels inherit their colors from field option definitions', () => {
  const {context} = setup();
  const columns = [
    {name:'業務の上位工程',optionColors:{'設計':'#112233'}},
    {name:'技術の高度化',optionColors:{'統計':'#e3a4c5'}},
    {name:'備考',type:'text'}
  ];
  const records = [
    {'業務の上位工程':'設計','技術の高度化':['統計','機械学習'],備考:'その他'},
    {'業務の上位工程':'評価','技術の高度化':['統計'],備考:'自由文'}
  ];
  const single = context.pivotValueColorMap(records,['技術の高度化'],columns);
  assert.equal(single.get('統計'),'#e3a4c5');
  assert.equal(single.has('機械学習'),false);
  const multi = context.pivotValueColorMap(records,['業務の上位工程','技術の高度化','備考'],columns);
  assert.equal(multi.get('業務の上位工程: 設計'),'#112233');
  assert.equal(multi.get('技術の高度化: 統計'),'#e3a4c5');
  assert.equal(multi.has('備考: その他'),false);
  assert.equal(multi.has('業務の上位工程: 評価'),false);
});

test('analysis removes independent cell color controls and stops saving colors in analysis YAML', () => {
  const {context} = setup();
  assert.doesNotMatch(html, /id="analysis-color-bar"/, 'separate color settings are removed from analysis');
  assert.doesNotMatch(html, /function renderColorControls\(/);
  const yaml = context.serializeAnalysisYaml({rows:['案件名'],columns:[],values:['案件名'],tooltip:[],filters:{},valueColors:{'["案件名","A"]':'#ff0000'}});
  assert.doesNotMatch(yaml, /^colors:/m, 'obsolete analysis-specific colors are no longer written');
  const parsed = context.parseAnalysisYaml(yaml+'colors: {}\n',['案件名']);
  assert.equal(parsed.valueColors,undefined, 'old analysis YAML remains readable but cannot override definition colors');
});

test('analysis offers detailed messages only in click-menu settings and retains the YAML selection', () => {
  const {context} = setup();
  const columns = [{name:'案件名'}, {name:'業務の高度化'}];
  for (const axis of ['rows','columns','values','filters']) {
    assert.deepEqual(Array.from(context.analysisPickerFields(axis, columns)), ['案件名','業務の高度化'], `${axis} does not offer detail text`);
  }
  assert.deepEqual(Array.from(context.analysisPickerFields('tooltip', columns)), ['案件名','業務の高度化','詳細メッセージ']);
  const analysis = {rows:['案件名'],columns:['業務の高度化'],values:['案件名'],tooltip:['詳細メッセージ'],filters:{}};
  const parsed = context.parseAnalysisYaml(context.serializeAnalysisYaml(analysis), ['案件名','業務の高度化']);
  assert.deepEqual(Array.from(parsed.tooltip), ['詳細メッセージ']);
  assert.throws(() => context.parseAnalysisYaml(context.serializeAnalysisYaml({...analysis,rows:['詳細メッセージ']}),['案件名','業務の高度化']), /rows: 未定義の項目/);
});

test('click-menu detail content preserves source field names and deduplicates matching project messages', () => {
  const {context} = setup();
  const columns = [{name:'案件名'},{name:'業務の高度化'},{name:'技術の高度化'}];
  const tree = {value:'案件A',children:[{value:'解像度',detail:'要因を検証',children:[{value:'統計',detail:'回帰分析を実施',children:[]}]}]};
  const records = context.treeRecords([{tree},{tree:structuredClone(tree)}], columns);
  const details = context.analysisDetailValues(records);
  assert.deepEqual(JSON.parse(JSON.stringify(details)), [
    {field:'業務の高度化',detail:'要因を検証'},
    {field:'技術の高度化',detail:'回帰分析を実施'}
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(context.analysisDetailValues(context.treeRecords([{tree:{value:'案件B',children:[]}}],columns)))), []);
});

test('pivot uses every defined select and multiselect option across row and column axes', () => {
  const {context} = setup();
  const columns = [
    {name:'工程',type:'select',options:['設計','評価']},
    {name:'品質',type:'multiselect',options:['正確性','妥当性']},
    {name:'技術',type:'select',options:['統計','機械学習']}
  ];
  const records = [{工程:'設計',品質:['正確性'],技術:'統計',案件名:'案件A'}];
  const pivot = context.makePivot(records,['工程','品質'],['技術'],['案件名'],columns);
  assert.deepEqual(JSON.parse(JSON.stringify(pivot.rows.map(row=>row.values))), [
    ['設計','正確性'],['設計','妥当性'],['評価','正確性'],['評価','妥当性']
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(pivot.columns.map(col=>col.values))), [['統計'],['機械学習']]);
  assert.deepEqual(JSON.parse(JSON.stringify(pivot.cells['["設計","正確性"]']['["統計"]'])), ['案件A']);
  assert.equal(pivot.cells['["設計","妥当性"]'],undefined, 'no matching data yields an empty cell');
  const noRecords = context.makePivot([],['工程'],['技術'],['案件名'],columns);
  assert.deepEqual(JSON.parse(JSON.stringify(noRecords.rows.map(row=>row.values))), [['設計'],['評価']]);
  assert.deepEqual(JSON.parse(JSON.stringify(noRecords.columns.map(col=>col.values))), [['統計'],['機械学習']]);
});

test('pivot keeps observed text axis values and out-of-definition existing selections', () => {
  const {context} = setup();
  const columns = [{name:'案件名',type:'text',options:[]},{name:'工程',type:'select',options:['設計','評価']}];
  const records = [{案件名:'案件A',工程:'旧工程',備考:'内容A'},{案件名:'案件B',工程:'設計',備考:'内容B'}];
  const pivot = context.makePivot(records,['案件名','工程'],[],['備考'],columns);
  assert.deepEqual(JSON.parse(JSON.stringify(pivot.rows.map(row=>row.values))), [
    ['案件A','設計'],['案件A','評価'],['案件A','旧工程'],
    ['案件B','設計'],['案件B','評価'],['案件B','旧工程']
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(pivot.columns.map(col=>col.values))), [[]]);
  assert.equal(pivot.cells['["案件A","評価"]'],undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(pivot.cells['["案件A","旧工程"]']['[]'])),['内容A']);
});

test('pivot cell displays only values even when multiple fields supply different colors', () => {
  const columns = [
    {id:'name',name:'案件名',type:'text',options:[],cardinality:'1:1'},
    {id:'stage',name:'工程: 区分',type:'select',options:['設計','評価'],cardinality:'1:1',optionColors:{'設計':'#112233'}},
    {id:'tech',name:'技術',type:'multiselect',options:['統計','機械学習'],cardinality:'1:1',optionColors:{'統計':'#dceafe'}}
  ];
  const snapshot = {detailUiVersion:1,columns,projects:[{id:'p1',tree:{value:'案件A',children:[
    {value:'設計',detail:'要件整理を実施',children:[{value:['統計'],detail:'回帰分析を実施',children:[]}]}
  ]}}],analysis:{rows:['工程: 区分'],columns:['技術'],values:['工程: 区分','技術'],tooltip:['詳細メッセージ'],filters:{}}};
  const {navigation,getElement,context} = setup(false,snapshot);
  navigation.analysis.dispatch('click');
  const findAll = (node, predicate) => [
    ...(predicate(node) ? [node] : []),
    ...(node.children ?? []).flatMap(child=>findAll(child,predicate))
  ];
  const chips = findAll(getElement('pivot-host'),node=>node.className==='cell-item');
  assert.deepEqual(chips.map(chip=>chip.textContent),['設計','統計']);
  assert.deepEqual(chips.map(chip=>chip.style.backgroundColor),['#112233','#dceafe']);
  assert.equal(findAll(getElement('pivot-host'),node=>node.className==='empty').length,3, 'unfilled option combinations show a dash');
  const trigger = findAll(getElement('pivot-host'),node=>node.className==='root-menu-trigger')[0];
  trigger.dispatch('click');
  assert.deepEqual(findAll(getElement('analysis-click-menu'),node=>node.className==='tooltip-value').map(node=>node.textContent),[
    '要件整理を実施','回帰分析を実施'
  ]);
  assert.equal(context.pivotCellDisplayValue('工程: 区分: 設計',['工程: 区分','技術']),'設計');
  assert.equal(context.pivotCellDisplayValue('技術: 統計',['工程: 区分','技術']),'統計');
});

test('analysis root buttons open only their project, switch selection, and position the click menu above the cell', () => {
  const columns = [
    {id:'name',name:'案件名',type:'text',options:[],cardinality:'1:1'},
    {id:'tech',name:'技術の高度化',type:'select',options:['統計'],cardinality:'1:1',allowDetail:true,optionColors:{'統計':'#e3a4c5'}}
  ];
  const projects = [
    {id:'p1',tree:{value:'案件A',children:[{value:'統計',detail:'回帰分析を実施',children:[]}]}},
    {id:'p2',tree:{value:'案件B',children:[{value:'統計',detail:'分類モデルを検証',children:[]}]}}
  ];
  const snapshot = {detailUiVersion:1,columns,projects,
    analysis:{rows:['技術の高度化'],columns:[],values:['技術の高度化'],tooltip:['技術の高度化','詳細メッセージ'],filters:{}}};
  const {navigation,getElement,find,context} = setup(false,snapshot);
  navigation.analysis.dispatch('click');
  const host = getElement('pivot-host');
  const findAll = (node,predicate) => [...(predicate(node)?[node]:[]),...(node.children??[]).flatMap(child=>findAll(child,predicate))];
  const buttons = findAll(host,node=>node.className==='root-menu-trigger');
  assert.deepEqual(buttons.map(button=>button.textContent),['①','②']);
  assert.deepEqual(buttons.map(button=>button.attributes['aria-label']),['案件Aの詳細を表示','案件Bの詳細を表示']);
  const cell = find(host,node=>node.tagName==='td'&&find(node,child=>child.className==='cell-root-links'));
  assert.ok(cell);
  assert.equal(cell.handlers.mouseenter,undefined,'hover no longer opens a menu');
  cell.rect = {top:430,bottom:495,left:220,right:420,width:200,height:65};
  const menu = getElement('analysis-click-menu');menu.offsetHeight=140;menu.offsetWidth=280;
  buttons[0].dispatch('click');
  assert.equal(menu.hidden,false);
  assert.equal(Number.parseInt(menu.style.top,10),282,'menu opens above the cell when space is available');
  assert.equal(buttons[0].attributes['aria-expanded'],'true');
  assert.deepEqual(menu.children.filter(node=>node.className==='tooltip-project').map(group=>find(group,node=>node.className==='tooltip-root').textContent),['案件A']);
  assert.equal(find(menu,node=>node.className==='tooltip-value').textContent,'回帰分析を実施');
  assert.equal(find(menu,node=>node.className==='tooltip-choice').style.backgroundColor,'#e3a4c5');
  buttons[1].dispatch('click');
  assert.deepEqual(menu.children.filter(node=>node.className==='tooltip-project').map(group=>find(group,node=>node.className==='tooltip-root').textContent),['案件B']);
  assert.equal(buttons[0].attributes['aria-expanded'],'false');
  assert.equal(buttons[1].attributes['aria-expanded'],'true');
  buttons[1].dispatch('click');
  assert.equal(menu.hidden,true,'re-clicking the active root closes its menu');
  buttons[0].dispatch('click');
  context.document.dispatch('keydown',{key:'Escape'});
  assert.equal(menu.hidden,true,'Escape closes the menu');
  cell.rect = {top:90,bottom:140,left:220,right:420,width:200,height:50};
  buttons[0].dispatch('click');
  assert.equal(Number.parseInt(menu.style.top,10),148,'menu moves below the cell when there is no space above');
  context.document.dispatch('click',{target:find(menu,node=>node.className==='tooltip-root')});
  assert.equal(menu.hidden,false,'clicks within the menu do not close it');
  context.document.dispatch('click',{target:new Element('div')});
  assert.equal(menu.hidden,true,'clicking elsewhere closes the menu');
  buttons[0].dispatch('click');
  find(menu,node=>node.className==='menu-close').dispatch('click');
  assert.equal(menu.hidden,true,'the close control dismisses the menu');
  assert.match(html, /<label>クリックメニュー<\/label>/,'picker name matches the click interaction');
});

test('click menu pairs definition-colored labels with their details without field headings or a project chip', () => {
  const columns = [
    {id:'name',name:'案件名',type:'text',options:[],cardinality:'1:1'},
    {id:'stage',name:'業務の上位工程',type:'select',options:['評価'],cardinality:'1:1',allowDetail:true,optionColors:{'評価':'#bed3e8'}},
    {id:'tech',name:'技術の高度化',type:'multiselect',options:['統計'],cardinality:'1:1',allowDetail:true,optionColors:{'統計':'#e3a4c5'}},
    {id:'time',name:'運用工数の削減',type:'select',options:['半自動化'],cardinality:'1:1',optionColors:{'半自動化':'#b9e5ce'}}
  ];
  const projects = [{id:'p1',tree:{value:'案件A',children:[
    {value:'評価',detail:'施策を比較',children:[
      {value:['統計'],detail:'モデルを検証',children:[
        {value:'半自動化',children:[]}
      ]}
    ]}
  ]}}];
  const snapshot = {detailUiVersion:1,columns,projects,analysis:{
    rows:['業務の上位工程'],columns:[],values:['業務の上位工程'],
    tooltip:['案件名','業務の上位工程','運用工数の削減','詳細メッセージ'],filters:{}
  }};
  const {navigation,getElement,find} = setup(false,snapshot);
  navigation.analysis.dispatch('click');
  const findAll = (node,predicate) => [...(predicate(node)?[node]:[]),...(node.children??[]).flatMap(child=>findAll(child,predicate))];
  find(getElement('pivot-host'),node=>node.className==='root-menu-trigger').dispatch('click');
  const menu = getElement('analysis-click-menu');
  assert.equal(find(menu,node=>node.className==='tooltip-root').textContent,'案件A');
  assert.deepEqual(findAll(menu,node=>node.className==='tooltip-field').map(node=>node.textContent),[],'field-name headings are absent');
  assert.equal(findAll(menu,node=>node.className==='tooltip-choice'&&node.textContent==='案件A').length,0,'project name is not a chip');
  const lines = findAll(menu,node=>node.className==='tooltip-entry');
  assert.deepEqual(lines.map(line=>[
    find(line,node=>node.className==='tooltip-choice')?.textContent,
    find(line,node=>node.className==='tooltip-value')?.textContent??null
  ]),[
    ['評価','施策を比較'],
    ['統計','モデルを検証'],
    ['半自動化','']
  ],'detail-only selection still shows source label and labels without details stay visible');
  assert.deepEqual(lines.map(line=>find(line,node=>node.className==='tooltip-choice')?.style.backgroundColor),['#bed3e8','#e3a4c5','#b9e5ce']);
});

test('click menu groups text and selectable fields separately with aligned detail separators', () => {
  const columns = [
    {id:'name',name:'案件名',type:'text',options:[],cardinality:'1:1'},
    {id:'notes',name:'支援内容',type:'text',options:[],cardinality:'1:1'},
    {id:'stage',name:'業務の上位工程',type:'select',options:['評価'],cardinality:'1:1',allowDetail:true,optionColors:{'評価':'#bed3e8'}},
    {id:'tech',name:'技術の高度化',type:'multiselect',options:['統計','機械学習'],cardinality:'1:1',allowDetail:true,optionColors:{'統計':'#e3a4c5','機械学習':'#b9e5ce'}}
  ];
  const projects = [{id:'p1',tree:{value:'案件A',children:[{value:'需要予測モデルを導入',children:[
    {value:'評価',detail:'施策を比較',children:[{value:['統計','機械学習'],detail:'精度を比較',children:[]}]}
  ]}]}}];
  const snapshot={detailUiVersion:1,columns,projects,analysis:{
    rows:['業務の上位工程'],columns:[],values:['業務の上位工程'],
    tooltip:['案件名','支援内容','業務の上位工程','技術の高度化','詳細メッセージ'],filters:{}
  }};
  const {navigation,getElement,find}=setup(false,snapshot);
  navigation.analysis.dispatch('click');
  find(getElement('pivot-host'),node=>node.className==='root-menu-trigger').dispatch('click');
  const menu=getElement('analysis-click-menu');
  const groups=menu.children.flatMap(node=>node.className==='tooltip-project'?node.children.filter(child=>child.className==='tooltip-group'):[]);
  assert.equal(find(menu,node=>node.className==='tooltip-root').textContent,'案件A');
  assert.deepEqual(groups.map(group=>group.attributes['data-field']),['支援内容','業務の上位工程','技術の高度化']);
  assert.deepEqual(groups.map(group=>{
    const header=find(group,node=>node.className==='tooltip-group-name');
    return header?[find(header,node=>node.className==='tooltip-field-label')?.textContent,find(header,node=>node.className==='tooltip-separator')?.textContent]:null;
  }),[null,['業務の上位工程','：'],['技術の高度化','：']]);
  const textLine=find(groups[0],node=>node.className==='tooltip-entry');
  assert.equal(find(textLine,node=>node.className==='tooltip-label').textContent,'支援内容');
  assert.equal(find(textLine,node=>node.className==='tooltip-value').textContent,'需要予測モデルを導入');
  assert.equal(find(textLine,node=>node.className==='tooltip-choice'),null,'text values are not chips');
  for(const group of groups.slice(1)){
    const lines=group.children.filter(child=>child.className==='tooltip-entry');
    assert.ok(lines.length);
    for(const line of lines){
      assert.equal(find(line,node=>node.className==='tooltip-bullet')?.textContent,'・');
      assert.equal(find(line,node=>node.className==='tooltip-separator')?.textContent,'：');
    }
  }
  assert.deepEqual(groups[2].children.filter(node=>node.className==='tooltip-entry').map(line=>find(line,node=>node.className==='tooltip-choice').textContent),['統計','機械学習']);
  assert.match(html,/\.analysis-click-menu \.tooltip-entry\{[^}]*display:grid;grid-template-columns:/,'shared grid columns align separator positions');
  assert.match(html,/\.analysis-click-menu \.tooltip-group-name\{[^}]*display:grid;grid-template-columns:/,'field header separator shares the same grid');
});

test('definition option editor toggles with a plain small chevron and no surrounding frame', () => {
  const {navigation, getElement, find} = setup();
  navigation.definition.dispatch('click');
  const editor = getElement('field-editor');
  const row = editor.children[1];
  const details = find(row, node => node.tagName === 'details' && node.className === 'definition-accordion');
  const chevron = find(details, node => node.className === 'definition-chevron');
  assert.ok(chevron, 'a separate, simple chevron is visible next to candidate summary');
  assert.equal(chevron.textContent, '＞');
  details.open = true;
  details.dispatch('toggle');
  assert.equal(chevron.textContent, '⋁');
  const accordion = html.match(/\n\.definition-accordion\{([^}]+)\}/)?.[1] || '';
  assert.match(accordion, /background:transparent/);
  const summary = html.match(/\.definition-accordion>summary\{([^}]+)\}/)?.[1] || '';
  assert.match(summary, /border:0/);
  const arrowRule = html.match(/\.definition-chevron\{([^}]+)\}/)?.[1] || '';
  assert.match(arrowRule, /font-size:12px/);
});

test('definition selects are borderless light gray while field names highlight on hover', () => {
  const dropdown = html.match(/#field-editor \.field-card>select\.control\{([^}]+)\}/)?.[1] || '';
  assert.match(dropdown, /border:0/);
  assert.match(dropdown, /background:#f7f8fa/);
  const dropdownHover = html.match(/#field-editor \.field-card>select\.control:hover\{([^}]+)\}/)?.[1] || '';
  assert.match(dropdownHover, /background:#f1f3f5/);
  const input = html.match(/#field-editor \.field-card>input\.control\{([^}]+)\}/)?.[1] || '';
  assert.match(input, /border:1px solid transparent/);
  assert.match(input, /background:transparent/);
  const hover = html.match(/#field-editor \.field-card>input\.control:hover\{([^}]+)\}/)?.[1] || '';
  assert.match(hover, /border-color:#c8d5e4/);
  assert.match(hover, /background:#f7f8fa/);
});

test('definition candidate summary shows a flat, wrapping label for every option with saved colors', () => {
  const {navigation, getElement, find} = setup();
  navigation.definition.dispatch('click');
  const row = getElement('field-editor').children[1];
  const accordion = find(row, node => node.tagName === 'details' && node.className === 'definition-accordion');
  const labels = find(accordion, node => node.className === 'definition-option-chips');
  assert.ok(labels, 'summary shows chips, not a joined candidate string');
  assert.deepEqual(labels.children.map(item => item.textContent), ['設計', '評価']);
  assert.equal(labels.children[0].style.backgroundColor, '#112233', 'defined option color is reflected');
  assert.equal(labels.children[1].style.backgroundColor, undefined, 'uncolored options retain the neutral style');
  const layout = html.match(/\.definition-option-chips\{([^}]+)\}/)?.[1] || '';
  assert.match(layout, /display:flex/);
  assert.match(layout, /flex-wrap:wrap/);
  const chipStyle = html.match(/\.definition-option-chip\{([^}]+)\}/)?.[1] || '';
  assert.match(chipStyle, /border-radius:3px/);
  assert.match(chipStyle, /box-shadow:none/);
  assert.ok(find(accordion, node => node.tagName === 'textarea' && node.className === 'option-area'), 'original option editor is preserved');
});

test('updating a defined label color also updates its candidate preview chip', () => {
  const {navigation, getElement, find, storage} = setup();
  navigation.definition.dispatch('click');
  const row = getElement('field-editor').children[1];
  const colorInput = find(row, node => node.tagName === 'input' && node.type === 'color' && node.getAttribute('aria-label') === '業務の上位工程 設計のラベル色');
  assert.ok(colorInput);
  colorInput.value = '#abcdef';
  colorInput.dispatch('change');
  const updatedRow = getElement('field-editor').children[1];
  const labels = find(updatedRow, node => node.className === 'definition-option-chips');
  assert.equal(labels.children[0].style.backgroundColor, '#abcdef');
  assert.equal(JSON.parse(storage.get('dx_three_screens_v2')).columns[1].optionColors['設計'], '#abcdef');
});

test('definition detail and color editors use flat surfaces without raised cards', () => {
  const panel = html.match(/#definition-gui \.panel\{([^}]+)\}/)?.[1] || '';
  assert.match(panel, /box-shadow:none/, 'definition editing panel has no raised shadow');
  const detailToggle = html.match(/#field-editor \.field-detail-toggle\{([^}]+)\}/)?.[1] || '';
  assert.match(detailToggle, /border:0/);
  assert.match(detailToggle, /background:transparent/);
  const colorRow = html.match(/#field-editor \.field-color-row\{([^}]+)\}/)?.[1] || '';
  assert.match(colorRow, /border:0/);
  assert.match(colorRow, /border-bottom:1px solid #e5edf3/, 'thin separator retains row boundaries');
  assert.match(colorRow, /background:transparent/);
  assert.match(colorRow, /border-radius:0/);
  const colorControl = html.match(/#field-editor \.field-color-row input\[type=color\]\{([^}]+)\}/)?.[1] || '';
  assert.match(colorControl, /border:0/);
  assert.match(colorControl, /background:transparent/);
});

test('definition rows use compact controls and spacing while allowing wrapped option labels', () => {
  const panel = html.match(/#definition-gui \.panel\{([^}]+)\}/)?.[1] || '';
  assert.match(panel, /padding:12px 16px/);
  const row = html.match(/#field-editor \.field-card\{([^}]+)\}/)?.[1] || '';
  assert.match(row, /padding:6px 0/);
  assert.match(row, /column-gap:6px/);
  assert.match(row, /row-gap:4px/);
  assert.doesNotMatch(row, /(?:^|;)height:/, 'row height is determined by wrapped content');
  const name = html.match(/#field-editor \.field-card>input\.control\{([^}]+)\}/)?.[1] || '';
  assert.match(name, /height:32px/);
  const select = html.match(/#field-editor \.field-card>select\.control\{([^}]+)\}/)?.[1] || '';
  assert.match(select, /height:32px/);
  const marker = html.match(/#field-editor \.field-card>\.root-mark,#field-editor \.field-card>\.cardinality-select\{([^}]+)\}/)?.[1] || '';
  assert.match(marker, /height:32px/);
  const removeButton = html.match(/#field-editor \.field-card>\.btn\{([^}]+)\}/)?.[1] || '';
  assert.match(removeButton, /height:30px/);
  const extra = html.match(/\.definition-accordion \.field-extra\{([^}]+)\}/)?.[1] || '';
  assert.match(extra, /padding:8px 8px 10px/);
  const wrapping = html.match(/\.definition-option-chips\{([^}]+)\}/)?.[1] || '';
  assert.match(wrapping, /flex-wrap:wrap/, 'compact rows still grow when labels wrap');
});

test('each definition name editor has a visible label on its left and larger editable text', () => {
  const {navigation, getElement, find, storage} = setup();
  navigation.definition.dispatch('click');
  const rows = getElement('field-editor').children;
  for (const row of rows) {
    const label = row.children.find(node => node.tagName === 'label' && node.className === 'field-name-label');
    const input = row.children.find(node => node.tagName === 'input' && node.className === 'control');
    assert.equal(label?.textContent, '項目名');
    assert.equal(label.getAttribute('for'), input.getAttribute('id'), 'label points at the adjacent editor');
    assert.equal(row.children.indexOf(label) + 1, row.children.indexOf(input), 'label is immediately before the editor');
  }
  const inputRule = html.match(/#field-editor \.field-card>input\.control\{([^}]+)\}/)?.[1] || '';
  assert.match(inputRule, /font-size:16px/);
  const field = find(rows[0], node => node.tagName === 'input' && node.className === 'control');
  field.value = '改修後の項目名';
  field.dispatch('change');
  assert.equal(JSON.parse(storage.get('dx_three_screens_v2')).columns[0].name, '改修後の項目名');
});

test('definition row boundaries are thin pale gray without individual card outlines', () => {
  const rowRule = html.match(/#field-editor \.field-card\{([^}]+)\}/)?.[1] || '';
  assert.match(rowRule, /border:0/);
  assert.match(rowRule, /border-bottom:1px solid #e8edf2/);
  assert.match(rowRule, /border-radius:0/);
  assert.match(rowRule, /background:transparent/);
  assert.match(html, /#field-editor \.field-card:last-child\{border-bottom:0\}/);
});

test('definition description editor is placed between name and candidate labels and saves its text', () => {
  const {navigation, getElement, find, storage} = setup();
  navigation.definition.dispatch('click');
  const row = getElement('field-editor').children[1];
  const descriptionRow = find(row, node => node.className === 'field-description-row');
  assert.ok(descriptionRow, 'each row has an explanation editor');
  const descriptionLabel = find(descriptionRow, node => node.tagName === 'label');
  const descriptionInput = find(descriptionRow, node => node.tagName === 'textarea');
  const nameInput = row.children.find(node => node.tagName === 'input' && node.className === 'control');
  const optionChips = find(row, node => node.className === 'definition-option-chips');
  assert.equal(descriptionLabel?.textContent, '項目説明');
  assert.equal(descriptionLabel.getAttribute('for'), descriptionInput.getAttribute('id'));
  assert.ok(row.children.indexOf(nameInput) < row.children.indexOf(descriptionRow), 'description follows the name');
  assert.ok(row.children.indexOf(descriptionRow) < row.children.findIndex(node => find(node, item => item === optionChips)), 'description precedes candidate chips');
  const textareaRule = html.match(/#field-editor \.field-description-row textarea\{([^}]+)\}/)?.[1] || '';
  assert.match(textareaRule, /font-size:11px/, 'same size as option labels');
  descriptionInput.value = '分類の意味と適用範囲を説明します。\n自由記述です。';
  descriptionInput.dispatch('change');
  assert.equal(JSON.parse(storage.get('dx_three_screens_v2')).columns[1].description, descriptionInput.value);
});

test('definition descriptions survive schema YAML round-trips and workspace backups', () => {
  const {context, storage} = setup();
  const schema = {columns: [
    {name:'案件名',type:'text',cardinality:'1:1',description:'改行\nおよび「引用符」'},
    {name:'工程',type:'select',cardinality:'1:1',options:['設計'],description:'目的・役割'}
  ]};
  const yaml = context.serializeSchema(schema);
  assert.match(yaml, /description:/);
  const restored = context.parseSchema(yaml);
  assert.equal(restored.columns[0].description, '改行\nおよび「引用符」');
  assert.equal(restored.columns[1].description, '目的・役割');
  assert.equal(context.validateSchema(restored), true);
  restored.columns[1].description = 123;
  assert.throws(() => context.validateSchema(restored), /description|項目説明/);

  const snapshot = JSON.parse(storage.get('dx_three_screens_v2'));
  snapshot.columns[1].description = '工程の補足';
  const backup = context.parseWorkspaceYaml(context.serializeWorkspaceYaml(snapshot));
  assert.equal(backup.columns[1].description, '工程の補足');
  const different = structuredClone(backup);
  different.columns[1].description = '別の説明';
  assert.throws(() => context.mergeWorkspaceYamlSnapshots([backup,different]), /項目定義が一致しません/);
});

test('initial six axes provide explanatory defaults and YAML shows a description field for every item', () => {
  const {navigation, formatting, getElement, find, storage, context} = setup(true);
  const columns = JSON.parse(storage.get('dx_three_screens_v2')).columns;
  assert.equal(columns.length, 6);
  for (const column of columns) {
    assert.ok(column.description.length >= 20, `${column.name} is explained in a useful sentence`);
  }
  assert.match(columns.find(col=>col.name==='業務の高度化').description, /品質|判断/);
  assert.match(columns.find(col=>col.name==='技術の高度化').description, /統計|機械学習/);
  navigation.definition.dispatch('click');
  const description = find(getElement('field-editor').children[1], node => node.tagName === 'textarea' && node.getAttribute('aria-label') === '業務の上位工程の項目説明');
  assert.equal(description.value, columns[1].description);
  formatting.yaml.dispatch('click');
  const definitionsYaml = getElement('definition-yaml').value;
  assert.equal(definitionsYaml.split('\n').filter(line=>line.startsWith('    description: ')).length, 6);
  const blank = context.serializeSchema({columns:[{name:'追加項目',type:'text',cardinality:'1:1',description:''}]});
  assert.match(blank, /description: ""/, 'new fields also get an editable YAML slot');
});

test('previously saved preset columns receive descriptions once while custom text remains untouched', () => {
  const old = {detailUiVersion:1,columns:[
    {id:'name',name:'案件名',type:'text',options:[],cardinality:'1:1'},
    {id:'businessStage',name:'業務の上位工程',type:'select',options:['設計'],cardinality:'1:1',description:'利用者が作成した独自の説明'},
    {id:'custom',name:'独自項目',type:'text',options:[],cardinality:'1:1'}
  ],projects:[{id:'p1',data:{name:'案件1',businessStage:'設計',custom:'任意'}}]};
  const first = setup(false,old);
  const migrated = JSON.parse(first.storage.get('dx_three_screens_v2'));
  assert.ok(migrated.columns[0].description.length >= 20, 'preset name was filled');
  assert.equal(migrated.columns[1].description, '利用者が作成した独自の説明');
  assert.equal(migrated.columns[2].description, '', 'custom fields keep empty descriptions');
  assert.equal(migrated.descriptionPresetVersion, 1);
  migrated.columns[0].description = '';
  const second = setup(false,migrated);
  const reloaded = JSON.parse(second.storage.get('dx_three_screens_v2'));
  assert.equal(reloaded.columns[0].description, '', 'a consciously cleared description stays empty after reload');
});

test('definition type and cardinality dropdowns use small text and align vertically on the right', () => {
  const {navigation, getElement} = setup();
  navigation.definition.dispatch('click');
  const row = getElement('field-editor').children[1];
  const selects = row.children.filter(node => node.tagName === 'select');
  assert.equal(selects.length, 2, 'type and relation are both available');
  assert.equal(selects[0].value, 'select');
  assert.equal(selects[1].value, '1:1');
  const dropdown = html.match(/#field-editor \.field-card>select\.control\{([^}]+)\}/)?.[1] || '';
  assert.match(dropdown, /font-size:11px/);
  const relation = html.match(/#field-editor \.field-card>\.root-mark,#field-editor \.field-card>\.cardinality-select\{([^}]+)\}/)?.[1] || '';
  assert.match(relation, /grid-column:4/);
  assert.match(relation, /grid-row:2/);
  assert.match(relation, /width:164px/);
  const description = html.match(/#field-editor \.field-description-row\{([^}]+)\}/)?.[1] || '';
  assert.match(description, /grid-row:2/);
  assert.match(description, /grid-column:2 \/ 4/);
});

test('definition rows can be reordered by dragging a grip, with keyboard arrows as an alternative', () => {
  const {navigation, getElement, find, storage} = setup();
  navigation.definition.dispatch('click');
  const rows = getElement('field-editor').children;
  const handle = find(rows[2], node => node.className === 'field-drag-handle');
  assert.ok(handle, 'row has a visible drag grip');
  assert.equal(handle.draggable, true);
  assert.equal(find(rows[2], node => node.textContent === '↑' || node.textContent === '↓'), null, 'arrow buttons are replaced');
  let transferred = '';
  handle.dispatch('dragstart', {dataTransfer:{setData:(type,value)=>{transferred=value;},effectAllowed:''}});
  assert.equal(transferred, 'tech');
  const target = rows[1];
  let prevented = false;
  target.dispatch('dragover', {preventDefault:()=>{prevented=true;},dataTransfer:{dropEffect:''}});
  assert.equal(prevented, true);
  target.dispatch('drop', {preventDefault:()=>{prevented=true;}});
  assert.deepEqual(JSON.parse(storage.get('dx_three_screens_v2')).columns.map(col=>col.name),
    ['案件名','技術の高度化','業務の上位工程']);

  const nextHandle = find(getElement('field-editor').children[1], node => node.className === 'field-drag-handle');
  nextHandle.dispatch('keydown', {key:'ArrowDown',preventDefault:()=>{}});
  assert.deepEqual(JSON.parse(storage.get('dx_three_screens_v2')).columns.map(col=>col.name),
    ['案件名','業務の上位工程','技術の高度化']);
});

test('projects are initially collapsed and expand independently without changing their data', () => {
  const {body, find, storage} = setup();
  assert.equal(body.children.length, 2);
  for (const row of body.children) {
    assert.match(row.className, /project-collapsed/);
    assert.equal(find(row, node => node.className === 'detail-message-wrap')?.hidden, false);
    assert.equal(find(row, node => node.className === 'detail-message-preview')?.hidden, false);
  }
  const openFirst = find(body.children[0], node => node.tagName === 'button' && node.textContent === '＞');
  assert.ok(openFirst, 'project title includes an expand button');
  assert.equal(openFirst.getAttribute('aria-expanded'), 'false');
  openFirst.dispatch('click');
  assert.match(body.children[0].className, /project-expanded/);
  assert.equal(find(body.children[0], node => node.className === 'detail-message-wrap')?.hidden, false);
  assert.match(body.children[1].className, /project-collapsed/);
  find(body.children[1], node => node.tagName === 'button' && node.textContent === '＞').dispatch('click');
  assert.match(body.children[0].className, /project-expanded/);
  assert.match(body.children[1].className, /project-expanded/);
  find(body.children[0], node => node.tagName === 'button' && node.textContent === '⋁').dispatch('click');
  assert.match(body.children[0].className, /project-collapsed/);
  assert.match(body.children[1].className, /project-expanded/);
  const state = JSON.parse(storage.get('dx_three_screens_v2'));
  assert.equal(state.projects[0].tree.children[0].value, '設計');
});

test('existing 1:N controls remain available when project details are collapsed', () => {
  const {body, find} = setup();
  const add = find(body.children[0].children[2], node => node.tagName === 'button' && node.textContent === '＋');
  assert.ok(add, '1:N add control remains visible');
  add.dispatch('click');
  assert.equal(body.children.length, 3);
  assert.match(body.children[0].className, /project-collapsed/);
  assert.match(body.children[1].className, /project-collapsed/);
  assert.equal(body.children[0].children[0].rowSpan, 2);
});

test('single selection uses the same filter menu with exclusive radio options', () => {
  const {body, find, storage} = setup();
  const stageCell = body.children[0].children[1];
  const label = find(stageCell, node => node.className === 'choice-chip');
  assert.equal(label?.textContent, '設計');
  const picker = find(stageCell, node => node.tagName === 'details' && node.className === 'multi-picker');
  assert.ok(picker, 'single choice uses the same filter dropdown component');
  const glyph = find(picker, node => node.className === 'filter-alt-icon');
  assert.ok(glyph);
  const inputs = [];
  const collect = node => {
    if (node.tagName === 'input') inputs.push(node);
    for (const child of node.children ?? []) collect(child);
  };
  collect(picker);
  assert.deepEqual(inputs.map(input => input.type), ['radio', 'radio', 'radio']);
  assert.equal(inputs[1].checked, true);
  assert.equal(new Set(inputs.map(input => input.name)).size, 1);
  picker.open = true;
  picker.dispatch('toggle');
  assert.equal(find(picker, node => node.className?.includes?.('choice-popover')).popoverOpen, true);
  inputs[2].checked = true;
  inputs[2].dispatch('change');
  const changed = find(body.children[0].children[1], node => node.className === 'choice-chip');
  assert.equal(changed?.textContent, '評価');
  assert.equal(picker.open, false, 'single picker closes after one choice');
  assert.equal(JSON.parse(storage.get('dx_three_screens_v2')).projects[0].tree.children[0].value, '評価');
});

test('multiple selections show one label per value and keep the 1:N controls', () => {
  const {body, find} = setup();
  const labels = node => {
    const results = [];
    const walk = item => {
      if (item?.className === 'choice-chip') results.push(item.textContent);
      for (const child of item?.children ?? []) walk(child);
    };
    walk(node);
    return results;
  };
  const techCell = body.children[0].children[2];
  assert.deepEqual(labels(techCell), ['統計']);
  const edit = find(techCell, node => node.tagName === 'summary');
  assert.equal(edit?.textContent, '');
  assert.ok(find(edit, node => node.className === 'filter-alt-icon'));
  const second = find(techCell, node => node.tagName === 'input' && node.attributes['aria-label'] === '技術の高度化 機械学習');
  second.checked = true;
  second.dispatch('change');
  assert.deepEqual(labels(techCell), ['統計', '機械学習']);
  assert.ok(find(techCell, node => node.tagName === 'button' && node.textContent === '＋'));
});

test('definition YAML preserves per-option label colors and validates mappings', () => {
  const {context} = setup();
  const schema = {columns: [
    {name: '案件名', type: 'text', cardinality: '1:1'},
    {name: '技術', type: 'multiselect', cardinality: '1:N', options: ['統計', '機械学習'], allowDetail: true,
      optionColors: {'統計': '#aabbcc', '機械学習': '#112233'}}
  ]};
  const yaml = context.serializeSchema(schema);
  assert.match(yaml, /optionColors:/);
  assert.match(yaml, /"統計": "#aabbcc"/);
  const parsed = context.parseSchema(yaml);
  assert.equal(context.validateSchema(parsed), true);
  assert.equal(parsed.columns[1].optionColors['機械学習'], '#112233');
  parsed.columns[1].optionColors['機械学習'] = '#hijklm';
  assert.throws(() => context.validateSchema(parsed), /色|#[Rr][Gg][Bb]/);
  delete parsed.columns[1].optionColors['機械学習'];
  parsed.columns[1].optionColors['未定義候補'] = '#ffffff';
  assert.throws(() => context.validateSchema(parsed), /未定義|候補/);
});

test('workspace YAML saves label colors and reports incompatible merged definitions', () => {
  const {context, storage} = setup();
  const source = JSON.parse(storage.get('dx_three_screens_v2'));
  const yaml = context.serializeWorkspaceYaml(source);
  const parsed = context.parseWorkspaceYaml(yaml);
  assert.equal(parsed.columns[1].optionColors['設計'], '#112233');
  assert.equal(parsed.columns[2].optionColors['統計'], '#e3a4c5');
  const incompatible = structuredClone(parsed);
  incompatible.columns[2].optionColors['統計'] = '#112233';
  assert.throws(() => context.mergeWorkspaceYamlSnapshots([parsed, incompatible]), /定義が一致しません/);
});

test('per-option color from definition applies to all matching labels and can be edited or cleared', () => {
  const {body, find, storage, navigation, getElement} = setup();
  const firstStage = find(body.children[0].children[1], node => node.className === 'choice-chip');
  assert.equal(firstStage?.style.backgroundColor, '#112233');
  const firstTech = find(body.children[0].children[2], node => node.className === 'choice-chip');
  assert.equal(firstTech?.style.backgroundColor, '#e3a4c5');
  navigation.definition.dispatch('click');
  const editor = getElement('field-editor');
  const picker = find(editor, node => node.tagName === 'input' && node.type === 'color' && node.attributes['aria-label'] === '技術の高度化 統計のラベル色');
  assert.ok(picker);
  picker.value = '#abc123';
  picker.dispatch('change');
  assert.equal(JSON.parse(storage.get('dx_three_screens_v2')).columns[2].optionColors['統計'], '#abc123');
  navigation.input.dispatch('click');
  assert.equal(find(body.children[0].children[2], node => node.className === 'choice-chip')?.style.backgroundColor, '#abc123');
  navigation.definition.dispatch('click');
  const reset = find(getElement('field-editor'), node => node.tagName === 'button' && node.attributes['aria-label'] === '技術の高度化 統計のラベル色を解除');
  assert.ok(reset);
  reset.dispatch('click');
  assert.equal(JSON.parse(storage.get('dx_three_screens_v2')).columns[2].optionColors['統計'], undefined);
});

test('initial demo renders visible preset colors for the four technology directions', () => {
  const {body, find, storage} = setup(true);
  const demo = JSON.parse(storage.get('dx_three_screens_v2'));
  const tech = demo.columns.find(column => column.name === '技術の高度化');
  for (const option of ['エンジニアリング', '統計', '機械学習', '推論・生成AI']) {
    assert.match(tech.optionColors[option], /^#[0-9a-f]{6}$/);
  }
  const engineering = find(body.children[0].children[3], node => node.className === 'choice-chip');
  assert.equal(engineering.style.backgroundColor, tech.optionColors['エンジニアリング']);
});

test('choice labels are compact and flat without gradients or shadows', () => {
  const rule = html.match(/\.entry-table \.choice-chip\{([^}]+)\}/)?.[1];
  assert.ok(rule, 'labels have a dedicated style rule');
  assert.match(rule, /border-radius:3px/);
  assert.match(rule, /padding:1px 5px/);
  assert.match(rule, /line-height:1\.35/);
  assert.match(rule, /box-shadow:none/);
  assert.match(rule, /background-image:none/);
  const listRule = html.match(/\.entry-table \.choice-chip-list\{([^}]+)\}/)?.[1];
  assert.match(listRule, /gap:3px/);
  const {body, find} = setup();
  assert.equal(find(body.children[0].children[1], node => node.className === 'choice-chip')?.textContent, '設計');
});

test('input table headers use dark blue-gray with white text while preserving light data cells', () => {
  const headerRule = html.match(/\.entry-table th\{([^}]+)\}/)?.[1];
  assert.ok(headerRule, 'input table has a dedicated header style');
  assert.match(headerRule, /background:#344f67/);
  assert.match(headerRule, /color:#fff/);
  assert.match(headerRule, /border-bottom:1px solid #223e55/);
  const {body, find} = setup();
  assert.equal(body.children.length, 2);
  assert.ok(find(body.children[0], node => node.className === 'choice-chip'));
});

test('collapsed row previews one line; expanded row displays and edits the complete message', () => {
  const {body, find, storage} = setup(true);
  const firstRow = body.children[0];
  const detailWrap = find(firstRow.children[1], node => node.className === 'detail-message-wrap');
  const collapsedPreview = find(firstRow.children[1], node => node.className === 'detail-message-preview');
  const collapsedEditor = find(firstRow.children[1], node => node.tagName === 'textarea' && node.attributes['aria-label'] === '業務の上位工程の詳細メッセージ');
  assert.equal(detailWrap.hidden, false);
  assert.equal(collapsedPreview.hidden, false);
  assert.equal(collapsedEditor.hidden, true);
  find(firstRow, node => node.tagName === 'button' && node.textContent === '＞').dispatch('click');
  const detail = find(body.children[0].children[1], node => node.tagName === 'textarea' && node.attributes['aria-label'] === '業務の上位工程の詳細メッセージ');
  const preview = find(body.children[0].children[1], node => node.className === 'detail-message-preview');
  assert.ok(detail, 'details stay under their existing column');
  assert.ok(preview, 'preview is available for the collapsed state');
  assert.equal(detail.hidden, false, 'the full editor is visible in the expanded row');
  assert.ok(preview.textContent.length > 0);
  assert.equal(preview.hidden, true);
  assert.equal(detail.getAttribute('data-autosize-detail'), 'true');
  assert.equal(detail.style.height, `${Math.max(65, detail.scrollHeight)}px`);
  const contents = '要件と設計の記録を詳細に残します。'.repeat(24);
  detail.value = contents;
  detail.dispatch('input');
  assert.equal(detail.style.height, `${Math.max(65, detail.scrollHeight)}px`);
  assert.equal(JSON.parse(storage.get('dx_three_screens_v2')).projects[0].tree.children[0].detail, contents);
  find(body.children[0], node => node.tagName === 'button' && node.textContent === '⋁').dispatch('click');
  const afterClose = find(body.children[0].children[1], node => node.className === 'detail-message-preview');
  const afterCloseEditor = find(body.children[0].children[1], node => node.tagName === 'textarea' && node.attributes['aria-label'] === '業務の上位工程の詳細メッセージ');
  assert.equal(afterClose.hidden, false);
  assert.equal(afterCloseEditor.hidden, true);
  assert.match(afterClose.textContent, /要件と設計/);
  assert.ok(afterClose.textContent.length > 10, 'preview retains text without truncating the saved data');
  Object.defineProperty(detail, 'scrollHeight', {configurable: true, value: undefined});
  detail.dispatch('input');
  assert.equal(detail.style.height, '65px', 'unknown size falls back to a usable minimum');
  const rules = [...html.matchAll(/\.entry-table \.entry-editor-choice \.detail-message-wrap textarea\.control\{([^}]+)\}/g)];
  const finalRule = rules.at(-1)?.[1] || '';
  assert.match(finalRule, /overflow:hidden/);
  assert.match(finalRule, /flex:none/);
  assert.match(finalRule, /resize:none/);
  const previewRule = html.match(/\.entry-table \.detail-message-preview\{([^}]+)\}/)?.[1] || '';
  assert.match(previewRule, /white-space:nowrap/);
  assert.match(previewRule, /text-overflow:ellipsis/);
  assert.match(previewRule, /overflow:hidden/);
  assert.match(previewRule, /cursor:default/);
});

test('long project names enlarge their collapsed row instead of showing a textarea scrollbar', () => {
  const {body, find, storage} = setup();
  const row = body.children[0];
  const name = find(row, node => node.tagName === 'textarea' && node.attributes['aria-label'] === '案件名');
  assert.ok(name);
  Object.defineProperty(name, 'scrollHeight', {configurable: true, value: 92});
  name.value = '日本語が長く折り返される案件名の例';
  name.dispatch('input');
  assert.equal(row.style.height, '92px');
  assert.match(html, /\.entry-table \.root-cell \.entry-editor-text>textarea\.control\{[^}]*overflow-y:hidden/);
  assert.equal(JSON.parse(storage.get('dx_three_screens_v2')).projects[0].tree.value, name.value);
});

test('project rows keep tight spacing while allowing expanded detail and 1:N controls', () => {
  const {body, find} = setup();
  assert.equal(body.children[0].style.height, '64px', 'collapsed row uses the compact baseline');
  find(body.children[0], node => node.tagName === 'button' && node.textContent === '＞').dispatch('click');
  assert.equal(body.children[0].style.height, '104px', 'expanded row no longer reserves 160px');
  assert.match(html, /\.entry-table tbody tr\{height:104px\}/, 'child rows also use a compact default');
  const baseChoice = html.match(/\.entry-table \.entry-editor-choice\{([^}]+)\}/)?.[1] || '';
  assert.match(baseChoice, /min-height:104px/);
  const collapsedChoice = html.match(/\.entry-table tr\.project-collapsed \.entry-editor-choice\{([^}]+)\}/)?.[1] || '';
  assert.match(collapsedChoice, /min-height:64px/);
  const finalChoice = [...html.matchAll(/\.entry-table \.entry-editor-choice\{([^}]+)\}/g)].at(-1)?.[1] || '';
  assert.match(finalChoice, /padding:5px 5px 6px/);
  assert.match(html, /\.entry-table \.entry-editor-choice:has\(>\.cell-entry-actions\)\{padding-bottom:28px\}/);
  const expandedDetail = find(body.children[0].children[1], node => node.tagName === 'textarea' && node.getAttribute('data-autosize-detail') === 'true');
  assert.equal(expandedDetail.hidden, false, 'full detail remains available in expanded rows');
  assert.ok(find(body.children[0], node => node.tagName === 'button' && node.textContent === '＋'), 'add controls remain');
});

test('expanded project has a slim left accent without a new row background', () => {
  const accent = html.match(/\.entry-table tr\.project-expanded \.root-cell::before\{([^}]+)\}/)?.[1];
  assert.ok(accent, 'project accent is scoped to the expanded root cell');
  assert.match(accent, /left:0/);
  assert.match(accent, /width:3px/);
  assert.match(accent, /background:#3d8b98/);
  const {body, find} = setup();
  assert.match(body.children[0].className, /project-collapsed/);
  find(body.children[0], node => node.tagName === 'button' && node.textContent === '＞').dispatch('click');
  assert.match(body.children[0].className, /project-expanded/);
  assert.match(body.children[1].className, /project-collapsed/);
  assert.doesNotMatch(accent, /background-color:/);
});

test('input project separators and editor spacing are subtle and consistent', () => {
  assert.match(html, /\.entry-table tbody td\{border-right-color:#e5edf3\}/);
  const firstRows = [...html.matchAll(/\.entry-table tr\.project-first>td\{([^}]+)\}/g)];
  assert.match(firstRows.at(-1)?.[1] || '', /border-top-color:#afc4d8/);
  const followRows = [...html.matchAll(/\.entry-table tr\.detail-follow>td\{([^}]+)\}/g)];
  assert.match(followRows.at(-1)?.[1] || '', /border-top-color:#e8eef5/);
  const editorRules = [...html.matchAll(/\.entry-table \.entry-editor-choice\{([^}]+)\}/g)];
  assert.match(editorRules.at(-1)?.[1] || '', /padding:5px 5px 6px/);
});

test('filter editors use the Google filter_alt symbol in borderless compact controls', () => {
  const {body, find} = setup();
  const single = find(body.children[0].children[1], node => node.tagName === 'summary');
  const multiple = find(body.children[0].children[2], node => node.tagName === 'summary');
  for (const control of [single, multiple]) {
    assert.ok(control);
    const glyph = find(control, node => node.className === 'filter-alt-icon');
    assert.ok(glyph, 'the editing affordance is a filter icon');
    assert.equal(glyph.getAttribute('aria-hidden'), 'true');
  }
  const buttonRule = [...html.matchAll(/\.entry-table \.multi-picker>summary\{([^}]+)\}/g)].map(match => match[1]).find(rule => rule.includes('width:20px')) || '';
  assert.match(buttonRule, /width:20px/);
  assert.match(buttonRule, /height:20px/);
  assert.match(buttonRule, /border:0/);
  assert.match(buttonRule, /background:#f1f3f5/);
  assert.match(html, /filter_alt_20px\.svg/);
  assert.match(html, /mask:var\(--filter-alt-glyph\)/);
});

test('project expand and collapse controls show only a simple glyph with no frame', () => {
  const {body, find} = setup();
  const collapsed = find(body.children[0], node => node.className === 'project-row-toggle');
  assert.equal(collapsed?.textContent, '＞');
  collapsed.dispatch('click');
  const expanded = find(body.children[0], node => node.className === 'project-row-toggle');
  assert.equal(expanded?.textContent, '⋁');
  const rule = [...html.matchAll(/\.project-row-toggle\{([^}]+)\}/g)].at(-1)?.[1] || '';
  assert.match(rule, /border:0/);
  assert.match(rule, /background:transparent/);
  assert.match(rule, /font-size:12px/);
  assert.match(rule, /width:17px/);
  assert.match(html, /\.project-row-toggle:hover\{background:transparent/);
});

test('dropdown options escape the scrolling table and open upward near the viewport bottom', () => {
  const {body, find} = setup();
  const picker = find(body.children[1].children[2], node => node.tagName === 'details' && node.className === 'multi-picker');
  const trigger = find(picker, node => node.tagName === 'summary');
  const popup = find(picker, node => node.className?.includes?.('choice-popover'));
  assert.ok(popup, 'options use a dedicated top-layer popover');
  assert.equal(popup.getAttribute('popover'), 'auto');
  trigger.rect = {top: 635, bottom: 655, left: 350, right: 370, width: 20, height: 20};
  popup.rect = {top: 0, bottom: 220, left: 0, right: 200, width: 200, height: 220};
  picker.open = true;
  picker.dispatch('toggle');
  assert.equal(popup.popoverOpen, true, 'popover enters the top layer');
  assert.ok(Number.parseFloat(popup.style.top) < trigger.rect.top, 'opens above near bottom');
  assert.equal(popup.style.position, 'fixed');
  popup.dispatch('toggle', {newState: 'closed'});
  assert.equal(picker.open, false, 'outside click also closes the picker');
});
