const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', error => console.log('PAGE ERROR:', error.message));
    page.on('requestfailed', request => console.log('REQUEST FAILED:', request.url(), request.failure().errorText));

    console.log("Navigating to file:///Users/adrish/Desktop/Projects/logistix/frontend/pages/driver_dashboard.html");
    await page.goto('file:///Users/adrish/Desktop/Projects/logistix/frontend/pages/driver_dashboard.html', {waitUntil: 'networkidle2'});

    // Also navigate to weather
    console.log("Navigating to file:///Users/adrish/Desktop/Projects/logistix/frontend/pages/executive_weather.html");
    await page.goto('file:///Users/adrish/Desktop/Projects/logistix/frontend/pages/executive_weather.html', {waitUntil: 'networkidle2'});

    await browser.close();
})();
