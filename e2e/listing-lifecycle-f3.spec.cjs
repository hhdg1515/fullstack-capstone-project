const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const AxeBuilder = require('@axe-core/playwright').default;
const { test: base, expect, chromium } = require('./local-browser.cjs');
const { localEnvironment } = require('./local.cjs');
const test = base.extend({ deployment:[async ({},use)=>{
  if (process.env.E2E_APP_ORIGIN) throw Error('F3 is disposable local only');
  const d=await localEnvironment({ownerListings:true}); try {await use(d);} finally {await d.close();}
},{timeout:180000}] });
async function setup(browser,d,width=1440) {
 const context=await browser.newContext({baseURL:d.origin,ignoreHTTPSErrors:true,viewport:{width,height:1000}});
 context.setDefaultTimeout(15000); context.setDefaultNavigationTimeout(20000);
 const headers={Origin:d.origin,'X-CSRF-Protection':'1'};
 const post=async(path,data)=>{const r=await context.request.post(path,{headers,data}); expect(r.ok(),path+' HTTP '+r.status()).toBe(true); return r.status()===204?null:r.json();};
 const account={email:randomUUID()+'@example.test',password:randomUUID()+'secret',firstName:'LifecycleA',lastName:'Synthetic'};
 await post('/api/auth/register',account); const page=await context.newPage();
 const menu=async()=>{const button=page.getByRole('button',{name:'Menu',exact:true});if(await button.isVisible())await button.click();};
 const inventory=async()=>{await menu();await page.getByRole('link',{name:'My Listings',exact:true}).first().click();};
 return {context,page,post,headers,account,menu,inventory};
}
async function decide(page,action,accept,type='confirm') {
 await test.step((accept?'approve ':'reject ')+type,async()=>{
  const observed=page.waitForEvent('dialog'); const pending=action().catch(error=>error);
  const dialog=await observed; expect(dialog.type()).toBe(type); if(accept)await dialog.accept();else await dialog.dismiss();
  const result=await pending;
  if(result instanceof Error) expect(result.message).toMatch(/ERR_ABORTED|interrupted/);
 });
}
const save=page=>page.getByRole('button',{name:'Save Draft',exact:true}).first();
const nameField=page=>page.getByLabel('Item name',{exact:true});
const noOverflow=async page=>expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
async function accessible(page) {const violations=(await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations.map(v=>v.id);await test.step('B3 F3 WCAG: '+(violations.join(', ')||'none'),async()=>expect(violations).toEqual([]));}
async function shot(page,label) {
 if(process.env.F3_SCREENSHOT_DIR){fs.mkdirSync(process.env.F3_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.F3_SCREENSHOT_DIR,label+'.png'),fullPage:!label.startsWith('f3-native-zoom')});}
}
for(const width of [1440,320,375]) test('F3 create/edit guards, history, reload, save and keyboard at '+width,async({isolatedBrowser: browser,deployment})=>{
 const s=await setup(browser,deployment,width),{page}=s;
 try{
  await page.goto('/app/listings');await expect(page.getByText('No listings yet.')).toBeVisible();await accessible(page);
  await page.getByRole('link',{name:'Create Listing',exact:true}).click();
  await nameField(page).fill('Unsent local chair');
  await decide(page,()=>s.inventory(),false);await expect(nameField(page)).toHaveValue('Unsent local chair');
  await decide(page,()=>page.goBack(),false);await expect(nameField(page)).toHaveValue('Unsent local chair');
  await decide(page,()=>page.goBack(),true);await expect(page.getByText('No listings yet.')).toBeVisible();
  await page.goForward();await expect(nameField(page)).toHaveValue('');
  await nameField(page).fill('Forward retained draft');
  await decide(page,()=>page.getByRole('button',{name:'Cancel',exact:true}).click(),false);await expect(nameField(page)).toHaveValue('Forward retained draft');
  await decide(page,()=>page.getByRole('button',{name:'Cancel',exact:true}).click(),true);await expect(page.getByRole('heading',{name:'My Listings',exact:true})).toBeVisible();
  await page.goBack();await nameField(page).fill('Forward unsaved protection');
  await decide(page,()=>page.goForward(),false);await expect(nameField(page)).toHaveValue('Forward unsaved protection');
  await decide(page,()=>page.goForward(),true);await expect(page.getByRole('heading',{name:'My Listings',exact:true})).toBeVisible();
  await page.goBack();await nameField(page).fill('Native reload protection');
  await decide(page,()=>page.evaluate(()=>{setTimeout(()=>location.reload(),0);}),false,'beforeunload');await expect(nameField(page)).toHaveValue('Native reload protection');
  await decide(page,()=>page.evaluate(()=>{setTimeout(()=>location.reload(),0);}),true,'beforeunload');await expect(nameField(page)).toHaveValue('');
  const name='F3 '+width+' '+'long-item-name'.repeat(9);
  const savedDialogs=[];const rejectSavedDialog=dialog=>{savedDialogs.push(dialog.type());dialog.dismiss();};page.on('dialog',rejectSavedDialog);
  await nameField(page).fill(name);await nameField(page).press('Tab');await expect(save(page)).toBeFocused();await save(page).press('Enter');
  await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();expect(new URL(page.url()).pathname).toMatch(/^\/app\/listings\/[a-f0-9]{24}$/);
  page.off('dialog',rejectSavedDialog);expect(savedDialogs).toEqual([]);
  const row=await deployment.db.collection('items').findOne({name});expect(row.planId).toBeUndefined();
  await page.getByRole('link',{name:'Edit listing',exact:true}).click();await page.getByLabel('Description',{exact:true}).fill('Unsaved description');
  await s.menu();const nav=page.getByRole('navigation',{name:'Primary'});await expect(nav.getByRole('link',{name:'My Listings',exact:true})).toHaveAttribute('aria-current','location');await expect(nav.getByRole('link',{name:'Find Free Items',exact:true})).not.toHaveAttribute('aria-current');
  const closeMenu=page.getByRole('button',{name:'Close menu',exact:true});if(await closeMenu.isVisible())await closeMenu.click();
  await decide(page,()=>s.inventory(),false);await expect(page.getByLabel('Description',{exact:true})).toHaveValue('Unsaved description');
  await decide(page,()=>page.goBack(),false);await expect(page.getByLabel('Description',{exact:true})).toHaveValue('Unsaved description');
  await page.getByLabel('Description',{exact:true}).fill('Saved final description');page.on('dialog',rejectSavedDialog);await save(page).click();
  await expect(page).toHaveURL(deployment.origin+'/app/listings/'+row._id);await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();await expect(page.getByText('Saved final description',{exact:true})).toBeVisible();
  await page.reload();await expect(page.getByText('Saved final description',{exact:true})).toBeVisible();
  page.off('dialog',rejectSavedDialog);expect(savedDialogs).toEqual([]);
  await page.getByRole('link',{name:'Edit listing',exact:true}).click();
  if(width===1440){
   // Practical 200% text/reflow stress at a narrowed CSS viewport.
   // This does not claim native browser-chrome zoom or physical device testing.
   await page.setViewportSize({width:720,height:500});
   await page.evaluate(()=>{document.documentElement.style.fontSize='200%';});
  }
  await noOverflow(page);await accessible(page);await shot(page,'f3-form-'+width+(width===1440?'-reflow':''));
  if(width===1440){await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>{document.documentElement.style.fontSize='';});await shot(page,'f3-form-1440');}
  await s.inventory();await expect(page.getByRole('link',{name,exact:true})).toBeVisible();await expect(page.getByText('Draft',{exact:true})).toBeVisible();await expect(page.getByText('Photos unavailable',{exact:true})).toBeVisible();
  await noOverflow(page);await accessible(page);await shot(page,'f3-inventory-'+width);
  expect(await deployment.db.collection('moveOutPlans').countDocuments()).toBe(0);
  await page.getByRole('link',{name:'Create Listing',exact:true}).click();await nameField(page).fill('Tab-close draft');
  await decide(page,()=>page.close({runBeforeUnload:true}),false,'beforeunload');expect(page.isClosed()).toBe(false);await expect(nameField(page)).toHaveValue('Tab-close draft');
  await decide(page,()=>page.close({runBeforeUnload:true}),true,'beforeunload');await expect.poll(()=>page.isClosed()).toBe(true);
 }finally{await s.context.close();}
});

test('F3 definite failure retains input; committed but lost create response stays locked without duplicate POST',async({isolatedBrowser: browser,deployment})=>{
 const s=await setup(browser,deployment,375),{page}=s;let posts=0;
 try{
  await page.goto('/app/listings/new');await nameField(page).fill('F3 recovery chair');
  await page.route('**/api/items',async route=>{if(route.request().method()!=='POST')return route.continue();posts++;await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:{code:'INVALID_ITEM',message:'Correct the description.',fields:[{field:'description',message:'Correct the description.'}]}})});},{times:1});
  await save(page).click();await expect(page.getByRole('alert')).toContainText('Correct the description');await expect(nameField(page)).toHaveValue('F3 recovery chair');await expect(save(page)).toBeEnabled();
  await decide(page,()=>s.inventory(),false);await expect(nameField(page)).toHaveValue('F3 recovery chair');
  await page.route('**/api/items',async route=>{if(route.request().method()!=='POST')return route.continue();posts++;const actual=await route.fetch();expect(actual.status()).toBe(201);await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'SERVICE_UNAVAILABLE',message:'Save response unavailable.'}})});},{times:1});
  await save(page).click();await expect(page.getByText(/The save result is uncertain/)).toBeVisible();await expect(nameField(page)).toHaveValue('F3 recovery chair');await expect(save(page)).toBeDisabled();
  await nameField(page).evaluate(e=>e.form.requestSubmit());expect(posts).toBe(2);
  await decide(page,()=>page.evaluate(()=>{setTimeout(()=>location.reload(),0);}),false,'beforeunload');await expect(nameField(page)).toHaveValue('F3 recovery chair');
  const popupPromise=page.waitForEvent('popup');await page.getByRole('link',{name:'Inspect My Listings in a new tab'}).click();const popup=await popupPromise;
  await expect(popup.getByRole('link',{name:'F3 recovery chair',exact:true})).toBeVisible();await popup.close();
  expect(await deployment.db.collection('items').countDocuments({name:'F3 recovery chair'})).toBe(1);
  await accessible(page);await shot(page,'f3-uncertain-create-375');
 }finally{await s.context.close();}
});

for(const edit of [false,true]) for(const status of [200,401]) test('F3 late '+(status===200&&!edit?201:status)+' '+(edit?'edit':'create')+' cannot navigate or leak after account switch',async({isolatedBrowser: browser,deployment})=>{
 const s=await setup(browser,deployment),{page}=s;let release;
 try{
  const old=edit?(await s.post('/api/items',{name:'Account A saved'})).item:null;
  await s.post('/api/auth/logout',{});const b={...s.account,email:randomUUID()+'@example.test',firstName:'LifecycleB'};await s.post('/api/auth/register',b);await s.post('/api/items',{name:'Account B only'});await s.post('/api/auth/logout',{});await s.post('/api/auth/login',{email:s.account.email,password:s.account.password});
  await page.goto(edit?'/app/items/'+old.id+'/edit':'/app/listings/new');await nameField(page).fill('A unresolved save');
  let entered;const arrived=new Promise(r=>{entered=r;}),gate=new Promise(r=>{release=r;});let mutations=0;
  await page.route(edit?'**/api/items/'+old.id:'**/api/items',async route=>{if(!['POST','PATCH'].includes(route.request().method()))return route.continue();mutations++;const response=await route.fetch();expect(response.status()).toBe(edit?200:201);const body=await response.body();entered();await gate;await route.fulfill(status===200?{response,body}:{status:401,contentType:'application/json',body:JSON.stringify({error:{code:'SESSION_EXPIRED',message:'Old session expired.'}})});},{times:1});
  await save(page).click();await arrived;await expect(page.getByRole('button',{name:'Saving…'}).first()).toBeDisabled();
  await s.menu();await decide(page,()=>page.getByRole('button',{name:'Logout',exact:true}).click(),true);
  await s.menu();await page.getByRole('link',{name:'Account',exact:true}).click();await page.getByLabel('Email',{exact:true}).fill(b.email);await page.getByLabel('Password',{exact:true}).fill(b.password);await page.getByRole('button',{name:'Login',exact:true}).click();
  await expect(page.getByText('Signed in as LifecycleB')).toHaveCount(1);await s.inventory();await expect(page.getByRole('link',{name:'Account B only',exact:true})).toBeVisible();
  await page.evaluate(()=>{window.f3Leaks=[];window.f3Observer=new MutationObserver(()=>{if(document.body.innerText.includes('A unresolved save'))window.f3Leaks.push('old-account-content');});window.f3Observer.observe(document.body,{childList:true,subtree:true,characterData:true});});
  const finished=page.waitForResponse(r=>r.request().method()===(edit?'PATCH':'POST')&&new URL(r.url()).pathname==='/api/items'+(edit?'/'+old.id:''));release();await finished;
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  expect(await page.evaluate(()=>{window.f3Observer.disconnect();return window.f3Leaks;})).toEqual([]);expect(new URL(page.url()).pathname).toBe('/app/listings');
  await expect(page.getByRole('link',{name:'Account B only',exact:true})).toBeVisible();await expect(page.getByText('A unresolved save',{exact:true})).toHaveCount(0);expect(mutations).toBe(1);
  expect(await deployment.db.collection('items').countDocuments({name:'A unresolved save'})).toBe(1);
 }finally{release?.();await s.context.close();}
});

test('F3 real bounded inventory pagination, retained-page retry, cursor restart and disabled state',async({isolatedBrowser: browser,deployment})=>{
 const s=await setup(browser,deployment,320),{page}=s;
 try{
  for(let i=0;i<21;i++)await s.post('/api/items',{name:'Inventory '+String(i).padStart(2,'0')});
  await page.goto('/app/listings');await expect(page.getByRole('list',{name:'Your listings'}).getByRole('listitem')).toHaveCount(20);
  let failedCursor;
  await page.route('**/api/me/items?*',async route=>{failedCursor=new URL(route.request().url()).searchParams.get('cursor');await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'SERVICE_UNAVAILABLE',message:'Please retry.'}})});},{times:1});
  await page.getByRole('button',{name:'Load More',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Please retry');await expect(page.getByRole('list',{name:'Your listings'}).getByRole('listitem')).toHaveCount(20);
  let retriedCursor;page.on('request',r=>{if(new URL(r.url()).pathname==='/api/me/items'&&new URL(r.url()).searchParams.has('cursor'))retriedCursor=new URL(r.url()).searchParams.get('cursor');});
  await page.getByRole('button',{name:'Retry',exact:true}).click();await expect(page.getByRole('list',{name:'Your listings'}).getByRole('listitem')).toHaveCount(21);expect(retriedCursor).toBe(failedCursor);await expect(page.getByRole('button',{name:'Load More',exact:true})).toHaveCount(0);
  await expect(page.getByRole('link',{name:'Inventory 00',exact:true})).toBeFocused();
  await page.reload();await page.route('**/api/me/items?*',route=>route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:{code:'INVALID_OWNER_QUERY',message:'Use a supported pagination link.'}})}),{times:1});
  await page.getByRole('button',{name:'Load More',exact:true}).click();await page.getByRole('button',{name:'Refresh listings',exact:true}).click();await expect(page.getByRole('list',{name:'Your listings'}).getByRole('listitem')).toHaveCount(20);
  await accessible(page);await noOverflow(page);
  await page.route('**/api/me/items',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'OWNER_LISTINGS_DISABLED',message:'Disabled'}})}),{times:1});
  await page.reload();await expect(page.getByRole('alert')).toContainText('temporarily unavailable');await expect(page.getByRole('list',{name:'Your listings'}).getByRole('listitem')).toHaveCount(0);await expect(page.getByRole('button',{name:'Retry',exact:true})).toHaveCount(0);
  await expect(page.getByRole('link',{name:'Existing plan inventory',exact:true})).toHaveCount(1);
  await accessible(page);await shot(page,'f3-disabled-320');expect(await deployment.db.collection('moveOutPlans').countDocuments()).toBe(0);
 }finally{await s.context.close();}
});

test('F3 native Chromium 200 percent tab zoom preserves form, keyboard save and inventory reflow',async({isolatedBrowser: browser,deployment})=>{
 const s=await setup(browser,deployment);const directory=fs.mkdtempSync(path.join(os.tmpdir(),'moveout-f3-zoom-'));let zoom;
 try{
  // Chromium's normal Page zoom preference in a disposable browser profile.
  // No extensions, admin policy changes, CSS transforms or pinch emulation.
  // CI must use full Chromium: the default headless shell has no Settings UI.
  zoom=await chromium.launchPersistentContext(directory,{channel:'chromium',headless:true,ignoreHTTPSErrors:true,viewport:{width:1440,height:1000},
   ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
  zoom.setDefaultTimeout(15000);await zoom.addCookies(await s.context.cookies());
  const page=zoom.pages()[0]||await zoom.newPage();await page.goto('chrome://settings/appearance');await page.locator('select#zoomLevel').selectOption('2');await expect(page.locator('select#zoomLevel')).toHaveValue('2');
  await page.goto(deployment.origin+'/app/listings/new');await expect(nameField(page)).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>({width:innerWidth,scale:devicePixelRatio,pinch:visualViewport.scale}))).toEqual({width:720,scale:2,pinch:1});
  await nameField(page).fill('Native zoom chair');const type=page.getByRole('combobox',{name:'Item type',exact:true});await type.fill('office chair');await type.press('ArrowDown');await type.press('Enter');
  await noOverflow(page);await accessible(page);await shot(page,'f3-native-zoom-200-form');
  await nameField(page).focus();await nameField(page).press('Tab');await expect(save(page)).toBeFocused();await save(page).press('Enter');
  await expect(page.getByRole('heading',{name:'Native zoom chair',exact:true})).toBeVisible();await page.reload();await expect(page.getByRole('heading',{name:'Native zoom chair',exact:true})).toBeVisible();
  const menu=page.getByRole('button',{name:'Menu',exact:true});if(await menu.isVisible())await menu.click();await page.getByRole('link',{name:'My Listings',exact:true}).first().click();
  await expect(page.getByRole('link',{name:'Native zoom chair',exact:true})).toBeVisible();await noOverflow(page);await accessible(page);await shot(page,'f3-native-zoom-200-inventory');
 }finally{if(zoom)await zoom.close();await s.context.close();fs.rmSync(directory,{recursive:true,force:true});}
});
