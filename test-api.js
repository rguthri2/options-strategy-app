#!/usr/bin/env node

/**
 * 🚀 Trading Platform - API Quick Test
 * Test key endpoints without external tools
 * 
 * Usage: node test-api.js
 */

const http = require('http');
const https = require('https');

const BASE_URL = 'http://localhost:5000/api';
let testsRun = 0;
let testsPassed = 0;
let testsFailed = 0;

// Color codes
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m'
};

// Helper to make HTTP requests
async function makeRequest(method, path, data = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, BASE_URL);
        const protocol = url.protocol === 'https:' ? https : http;
        
        const options = {
            method,
            headers: {
                'Content-Type': 'application/json',
            },
        };

        const req = protocol.request(url, options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(body);
                    resolve({ status: res.statusCode, body: parsed });
                } catch {
                    resolve({ status: res.statusCode, body });
                }
            });
        });

        req.on('error', reject);

        if (data) {
            req.write(JSON.stringify(data));
        }
        req.end();
    });
}

// Test helper
async function test(description, method, path, data = null, expectedStatus = 200) {
    testsRun++;
    process.stdout.write(`${colors.blue}Testing:${colors.reset} ${description}... `);

    try {
        const result = await makeRequest(method, path, data);
        
        if (result.status === expectedStatus || result.status === 200) {
            console.log(`${colors.green}✅ PASS${colors.reset} (HTTP ${result.status})`);
            testsPassed++;
            return result;
        } else {
            console.log(`${colors.red}❌ FAIL${colors.reset} (HTTP ${result.status}, expected ${expectedStatus})`);
            console.log(`  Response: ${JSON.stringify(result.body).substring(0, 100)}`);
            testsFailed++;
            return result;
        }
    } catch (error) {
        console.log(`${colors.red}❌ ERROR${colors.reset}: ${error.message}`);
        testsFailed++;
        return null;
    }
}

// Main test suite
async function runTests() {
    console.log('');
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║       Trading Platform - API Test Suite                    ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log('');

    // Test 1: Health Check
    console.log(`${colors.yellow}1. Health & Connectivity${colors.reset}`);
    await test('Health check', 'GET', '/health');
    console.log('');

    // Test 2: Stock Operations
    console.log(`${colors.yellow}2. Stock Operations${colors.reset}`);
    await test('Get all stocks', 'GET', '/stocks');
    await test('Search stocks', 'GET', '/stocks/search/AAPL');
    await test('Get top movers', 'GET', '/stocks/top/movers');
    console.log('');

    // Test 3: Price Data
    console.log(`${colors.yellow}3. Price Data${colors.reset}`);
    await test('Get price history', 'GET', '/prices/AAPL?days=30');
    await test('Get latest price', 'GET', '/prices/AAPL/latest');
    console.log('');

    // Test 4: Technical Indicators
    console.log(`${colors.yellow}4. Technical Indicators${colors.reset}`);
    await test('Get latest indicators', 'GET', '/indicators/AAPL');
    await test('Scan breakouts', 'GET', '/indicators/scan/breakouts');
    await test('Scan gaps', 'GET', '/indicators/scan/gaps');
    await test('Scan reversals', 'GET', '/indicators/scan/reversals');
    console.log('');

    // Test 5: Portfolio Management
    console.log(`${colors.yellow}5. Portfolio Management${colors.reset}`);
    await test('Get portfolio', 'GET', '/portfolio/user-1');
    
    const positionData = {
        user_id: 'user-1',
        symbol: 'AAPL',
        entry_price: 195.50,
        shares: 10,
        position_type: 'long',
        stop_loss: 185.00,
        take_profit: 210.00
    };
    await test('Create position', 'POST', '/portfolio', positionData, 201);
    console.log('');

    // Test 6: Alerts
    console.log(`${colors.yellow}6. Alerts Management${colors.reset}`);
    await test('Get alerts', 'GET', '/alerts/user-1');
    
    const alertData = {
        user_id: 'user-1',
        symbol: 'AAPL',
        alert_type: 'price',
        trigger_price: 200,
        trigger_condition: 'above'
    };
    await test('Create alert', 'POST', '/alerts', alertData, 201);
    console.log('');

    // Test 7: Scanner
    console.log(`${colors.yellow}7. Scanner Operations${colors.reset}`);
    const filterData = {
        minPrice: 100,
        maxPrice: 500,
        minVolume: 1000000,
        limit: 20
    };
    await test('Filter stocks', 'POST', '/scanner/filter', filterData);
    console.log('');

    // Results Summary
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║              Test Results Summary                          ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log(`Tests Run:  ${testsRun}`);
    console.log(`${colors.green}Passed:     ${testsPassed}${colors.reset}`);
    console.log(`${colors.red}Failed:     ${testsFailed}${colors.reset}`);
    console.log('');

    if (testsFailed === 0) {
        console.log(`${colors.green}🎉 All tests passed!${colors.reset}`);
        process.exit(0);
    } else {
        console.log(`${colors.red}⚠️  Some tests failed. Check logs above.${colors.reset}`);
        process.exit(1);
    }
}

// Run tests
runTests().catch(error => {
    console.error(`${colors.red}Fatal error:${colors.reset}`, error);
    process.exit(1);
});
