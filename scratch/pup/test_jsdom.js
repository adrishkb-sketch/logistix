const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync('../../frontend/pages/driver_dashboard.html', 'utf8');

const virtualConsole = new jsdom.VirtualConsole();
virtualConsole.on("jsdomError", (error) => {
  console.error("JSDOM Error:", error.message, error.stack);
});
virtualConsole.on("error", (msg, ...args) => {
  console.error("PAGE ERROR:", msg, ...args);
});
virtualConsole.on("warn", (msg, ...args) => {
  console.warn("PAGE WARN:", msg, ...args);
});
virtualConsole.on("log", (msg, ...args) => {
  console.log("PAGE LOG:", msg, ...args);
});

const dom = new JSDOM(html, {
  runScripts: "dangerously",
  resources: "usable",
  virtualConsole
});
