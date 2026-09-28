import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {chromium} from 'playwright';

const root=resolve(import.meta.dirname,'..');
const require=createRequire(import.meta.url);
const browserCode=await build({
  stdin:{contents:`
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {QuestionForm} from '../../extensions/aipro-chat/src/QuestionForm.jsx';
    createRoot(document.getElementById('root')).render(
      <div className="app-shell"><QuestionForm
        question={{id:'preview',text:'이번 분기 성과와 다음 계획을 알려주세요.',kind:'text',options:[],inputMode:'long_text',draft:''}}
        onDraft={async()=>{}} onChoose={async()=>false}/></div>
    );
  `,resolveDir:root,sourcefile:'question-autogrow-preview.jsx',loader:'jsx'},
  bundle:true,format:'iife',platform:'browser',write:false,outdir:'question-preview',loader:{'.jsx':'jsx'},logLevel:'silent',
  plugins:[{name:'one-react',setup(build){build.onResolve({filter:/^react(?:-dom)?(?:\/.*)?$/},args=>({path:require.resolve(args.path)}));}}]
});
const cssFiles=[
  'extensions/aipro-chat/node_modules/@e2e/cx-design-system/dist/styles.css',
  'extensions/aipro-chat/design/agent-deck.css',
  'extensions/aipro-chat/src/app.css',
  'extensions/aipro-chat/src/surfaces.css',
  'extensions/aipro-chat/src/interaction-forms.css'
];
const css=(await Promise.all(cssFiles.map(file=>readFile(resolve(root,'../..',file),'utf8')))).join('\n');
await mkdir(join(root,'verification'),{recursive:true});
const browser=await chromium.launch({headless:true});
try {
  for(const width of [320,380,1100]){
    const page=await browser.newPage({viewport:{width,height:850}});
    page.setDefaultTimeout(5000);
    page.on('pageerror',error=>console.error('preview error:',error.message));
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.setContent(`<!doctype html><html lang="ko"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div></body></html>`);
    await page.addScriptTag({content:browserCode.outputFiles.find(file=>file.path.endsWith('.js')).text});
    const field=page.getByRole('textbox',{name:'직접 답변'});
    await field.waitFor();
    assert.equal(await page.getByText('Enter로 전송',{exact:true}).count(),0);
    const sizing=await field.evaluate(el=>({resize:getComputedStyle(el).resize,form:el.closest('form')?.className,css:[...document.styleSheets].flatMap(sheet=>{try{return[...sheet.cssRules].filter(rule=>rule.selectorText?.includes('.interaction-input textarea')).map(rule=>rule.cssText);}catch{return[];}})}));
    assert.equal(sizing.resize,'none',JSON.stringify(sizing));
    const text='성과와 근거를 확인했습니다. 다음 계획을 세웁니다.\n'.repeat(18);
    await field.fill(text);
    const more=page.getByRole('button',{name:'더 보기'});
    await more.waitFor();
    const compact=await field.evaluate(el=>el.clientHeight);
    await page.screenshot({path:join(root,'verification',`question-autogrow-compact-${width}.png`)});
    await more.click();
    const expanded=await field.evaluate(el=>el.clientHeight);
    assert(expanded>compact+20,`expected an expanded answer at ${width}px: ${compact} -> ${expanded}`);
    assert.equal(await field.inputValue(),text);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:join(root,'verification',`question-autogrow-${width}.png`)});
    await page.getByRole('button',{name:'접기'}).click();
    assert((await field.evaluate(el=>el.clientHeight))<expanded-20);
    assert.equal(await field.inputValue(),text);
    await page.close();
  }
  console.log('question auto-grow: 3 widths passed');
} finally {await browser.close();}
