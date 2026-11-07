const fs = require('fs');
const path = require('path');

const htmlFiles = fs.readdirSync('public').filter(f => f.endsWith('.html'));

const issues = [];

for (const htmlFile of htmlFiles) {
  const fullPath = path.join('public', htmlFile);
  const content = fs.readFileSync(fullPath, 'utf8');

  // Check <a href="...">
  const aRegex = /<a\s+[^>]*href=["']([^"']+)["']/gi;
  let m;
  while ((m = aRegex.exec(content)) !== null) {
    const href = m[1];
    if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) continue;
    const cleanHref = href.split('?')[0].split('#')[0];
    const targetPath = path.join('public', cleanHref);
    if (!fs.existsSync(targetPath)) {
      issues.push(`Broken link in ${htmlFile}: <a href="${href}"> -> target "${cleanHref}" does not exist!`);
    }
  }

  // Check <img src="...">
  const imgRegex = /<img\s+[^>]*src=["']([^"']+)["']/gi;
  while ((m = imgRegex.exec(content)) !== null) {
    const src = m[1];
    if (src.startsWith('data:') || src.startsWith('http://') || src.startsWith('https://')) continue;
    const targetPath = path.join('public', src);
    if (!fs.existsSync(targetPath)) {
      issues.push(`Broken image in ${htmlFile}: <img src="${src}"> -> file does not exist!`);
    }
  }

  // Check <link href="...">
  const linkRegex = /<link\s+[^>]*href=["']([^"']+)["']/gi;
  while ((m = linkRegex.exec(content)) !== null) {
    const href = m[1];
    if (href.startsWith('http://') || href.startsWith('https://')) continue;
    const targetPath = path.join('public', href);
    if (!fs.existsSync(targetPath)) {
      issues.push(`Broken stylesheet/link in ${htmlFile}: <link href="${href}"> -> file does not exist!`);
    }
  }

  // Check <script src="...">
  const scriptRegex = /<script\s+[^>]*src=["']([^"']+)["']/gi;
  while ((m = scriptRegex.exec(content)) !== null) {
    const src = m[1];
    if (src.startsWith('http://') || src.startsWith('https://')) continue;
    const targetPath = path.join('public', src);
    if (!fs.existsSync(targetPath)) {
      issues.push(`Broken script in ${htmlFile}: <script src="${src}"> -> file does not exist!`);
    }
  }
}

console.log(`Audited ${htmlFiles.length} HTML files.`);
if (issues.length === 0) {
  console.log('No broken links, images, scripts, or stylesheets found in HTML files.');
} else {
  issues.forEach(i => console.log('ISSUE:', i));
}
