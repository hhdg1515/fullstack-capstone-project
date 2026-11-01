const { randomUUID } = require('node:crypto');
const AxeBuilder = require('@axe-core/playwright').default;
const { test: base, expect } = require('@playwright/test');
const { localEnvironment } = require('./local.cjs');
const test = base.extend({ deployment: [async ({}, use) => { if (process.env.E2E_APP_ORIGIN) throw Error('F2 is local only'); const d = await localEnvironment({ownerListings:true}); try { await use(d); } finally { await d.close(); } }, {timeout:180000}] });
for (const width of [1440,320,375]) test('draft form timezone, accessible errors and stable submit at ' + width, async ({browser,deployment})=>{
 const context=await browser.newContext({baseURL:deployment.origin,ignoreHTTPSErrors:true,viewport:{width,height:900}});
 try {
  const headers={Origin:deployment.origin,'X-CSRF-Protection':'1'};
  const signup=await context.request.post('/api/auth/register',{headers,data:{email:randomUUID()+'@example.test',password:randomUUID()+'secret',firstName:'Form',lastName:'Synthetic'}}); expect(signup.status()).toBe(201);
  const page=await context.newPage(); page.on('dialog',d=>d.accept()); const name='F2 chair '+randomUUID().slice(0,8);
  await page.goto('/app/listings/new'); await page.getByRole('button',{name:'Save Draft',exact:true}).first().click();
  await expect(page.getByLabel('Item name')).toBeFocused(); await expect(page.getByLabel('Item name')).toHaveAttribute('aria-invalid','true');
  await page.getByLabel('Item name').fill(name);
  await page.getByLabel('Item name').press('Tab'); await expect(page.getByRole('button',{name:'Save Draft',exact:true}).first()).toBeFocused();
  await page.getByRole('button',{name:'Save Draft',exact:true}).first().press('Enter');
  await expect(page.getByRole('heading',{name,exact:true})).toBeVisible(); let row=await deployment.db.collection('items').findOne({name}); expect(row.planId).toBeUndefined(); expect(row.pickupTimeZone).toBeNull();
  await page.getByRole('link',{name:'Edit listing',exact:true}).click();
  await page.getByLabel('State',{exact:true}).selectOption('06'); await page.getByLabel('Metro area',{exact:true}).selectOption('31080');
  await expect(page.getByLabel('Pickup timezone',{exact:true})).toHaveValue(''); await page.getByRole('button',{name:'Use suggested timezone'}).click();
  await expect(page.getByLabel('Confirm this pickup timezone')).not.toBeChecked(); await page.getByLabel('Confirm this pickup timezone').check();
  await page.getByLabel('Pickup deadline',{exact:true}).fill('2027-11-12');
  const type=page.getByRole('combobox',{name:'Item type',exact:true}); await type.fill('office chair'); await type.press('ArrowDown'); await type.press('Enter');
  const save=page.getByRole('button',{name:'Save Draft',exact:true}).first(); await save.click(); await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();
  row=await deployment.db.collection('items').findOne({name}); expect(row.timeZoneConfirmedAt).toBeTruthy(); expect(row.expiresAt.toISOString()).toBe('2027-11-13T08:00:00.000Z'); expect(row.itemTypeId).toBe('office-chair');
  await page.getByRole('link',{name:'Edit listing',exact:true}).click(); await page.getByLabel('City (optional)').fill('Updated city'); await expect(page.getByLabel('Confirm this pickup timezone')).not.toBeChecked();
  await page.getByRole('button',{name:'Save Draft',exact:true}).last().click(); await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();
  row=await deployment.db.collection('items').findOne({name}); expect(row.timeZoneConfirmedAt).toBeNull(); expect(row.expiresAt).toBeUndefined();
  await page.getByRole('link',{name:'Edit listing',exact:true}).click(); await page.getByLabel('Pickup timezone',{exact:true}).fill('UTC'); await page.getByLabel('Available from (optional)').fill('2000-01-01');
  await page.getByRole('button',{name:'Save Draft',exact:true}).first().click(); await expect(page.getByLabel('Available from (optional)')).toBeFocused(); await expect(page.getByLabel('Available from (optional)')).toHaveAttribute('aria-invalid','true');
  const errors=(await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations.map(v=>v.id); await test.step('B3 F2 '+width+' WCAG: '+(errors.join(', ')||'none'),async()=>expect(errors).toEqual([]));
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.getByLabel('Available from (optional)').fill('2027-11-01'); await expect(page.getByLabel('Available from (optional)')).toHaveAttribute('aria-invalid','false');
  const updated=await context.request.patch('/api/items/'+row._id,{headers,data:{version:row.version,description:'Concurrent version'}}); expect(updated.status()).toBe(200);
  await page.getByLabel('Item name').fill('Keep unsaved edit'); await page.getByRole('button',{name:'Save Draft',exact:true}).first().click();
  await expect(page.getByRole('alert')).toContainText('This draft changed'); await expect(page.getByLabel('Item name')).toHaveValue('Keep unsaved edit'); await expect(page.getByRole('button',{name:'Save Draft',exact:true}).first()).toBeDisabled();
  expect(await deployment.db.collection('moveOutPlans').countDocuments()).toBe(0);
 } finally {await context.close();}
});
