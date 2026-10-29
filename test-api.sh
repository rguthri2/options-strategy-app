#!/bin/bash
# 📊 API Testing Script - Test all endpoints automatically

BASE_URL="http://localhost:5000/api"
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "╔════════════════════════════════════════════════════════════╗"
echo "║       Trading Platform - API Test Suite                    ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Test counter
TESTS_PASSED=0
TESTS_FAILED=0

# Helper function
test_endpoint() {
    local method=$1
    local endpoint=$2
    local data=$3
    local expected_code=$4
    local description=$5

    echo -n "Testing: $description... "

    if [ -z "$data" ]; then
        response=$(curl -s -w "\n%{http_code}" -X $method "$BASE_URL$endpoint")
    else
        response=$(curl -s -w "\n%{http_code}" -X $method "$BASE_URL$endpoint" -H "Content-Type: application/json" -d "$data")
    fi

    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | head -n-1)

    if [ "$http_code" = "$expected_code" ] || [ "$http_code" = "200" ]; then
        echo -e "${GREEN}✅ PASS${NC} (HTTP $http_code)"
        ((TESTS_PASSED++))
    else
        echo -e "${RED}❌ FAIL${NC} (HTTP $http_code, expected $expected_code)"
        echo "  Response: $body"
        ((TESTS_FAILED++))
    fi
}

# Test 1: Health Check
echo -e "${YELLOW}1. Health & Connectivity${NC}"
test_endpoint "GET" "/health" "" "200" "Health check"
echo ""

# Test 2: Stock Operations
echo -e "${YELLOW}2. Stock Operations${NC}"
test_endpoint "GET" "/stocks" "" "200" "Get all stocks"
test_endpoint "GET" "/stocks/search/AAPL" "" "200" "Search stocks"
test_endpoint "GET" "/stocks/top/movers" "" "200" "Get top movers"
echo ""

# Test 3: Price Data
echo -e "${YELLOW}3. Price Data${NC}"
test_endpoint "GET" "/prices/AAPL?days=30" "" "200" "Get price history"
test_endpoint "GET" "/prices/AAPL/latest" "" "200" "Get latest price"
echo ""

# Test 4: Technical Indicators
echo -e "${YELLOW}4. Technical Indicators${NC}"
test_endpoint "GET" "/indicators/AAPL" "" "200" "Get latest indicators"
test_endpoint "GET" "/indicators/scan/breakouts" "" "200" "Scan breakouts"
test_endpoint "GET" "/indicators/scan/gaps" "" "200" "Scan gaps"
test_endpoint "GET" "/indicators/scan/reversals" "" "200" "Scan reversals"
echo ""

# Test 5: Portfolio Management
echo -e "${YELLOW}5. Portfolio Management${NC}"
test_endpoint "GET" "/portfolio/user-1" "" "200" "Get portfolio"

POSITION_DATA='{"user_id":"user-1","symbol":"AAPL","entry_price":195.50,"shares":10,"position_type":"long","stop_loss":185.00,"take_profit":210.00}'
test_endpoint "POST" "/portfolio" "$POSITION_DATA" "201" "Create position"
echo ""

# Test 6: Alerts
echo -e "${YELLOW}6. Alerts Management${NC}"
test_endpoint "GET" "/alerts/user-1" "" "200" "Get alerts"

ALERT_DATA='{"user_id":"user-1","symbol":"AAPL","alert_type":"price","trigger_price":200,"trigger_condition":"above"}'
test_endpoint "POST" "/alerts" "$ALERT_DATA" "201" "Create alert"
echo ""

# Test 7: Scanner
echo -e "${YELLOW}7. Scanner Operations${NC}"
FILTER_DATA='{"minPrice":100,"maxPrice":500,"minVolume":1000000,"limit":20}'
test_endpoint "POST" "/scanner/filter" "$FILTER_DATA" "200" "Filter stocks"
echo ""

# Results Summary
echo "╔════════════════════════════════════════════════════════════╗"
echo "║              Test Results Summary                          ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo -e "Passed: ${GREEN}${TESTS_PASSED}${NC}"
echo -e "Failed: ${RED}${TESTS_FAILED}${NC}"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}🎉 All tests passed!${NC}"
    exit 0
else
    echo -e "${RED}⚠️  Some tests failed. Check logs above.${NC}"
    exit 1
fi
