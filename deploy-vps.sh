#!/bin/bash

# Deploy to VPS script
# Usage: ./deploy-vps.sh <vps_ip> <api_key>

VPS_IP=${1:-"70.36.114.244"}
FINNHUB_KEY=$2
DOMAIN=${3:-"trading.example.com"}

if [ -z "$FINNHUB_KEY" ]; then
    echo "Usage: $0 <vps_ip> <finnhub_api_key> [domain]"
    exit 1
fi

echo "🚀 Deploying to VPS: $VPS_IP"
echo ""

# SSH commands to run on VPS
ssh -o StrictHostKeyChecking=no root@$VPS_IP << EOF
#!/bin/bash
set -e

echo "Updating system..."
apt-get update && apt-get upgrade -y

echo "Installing Docker..."
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh
rm get-docker.sh

echo "Installing Docker Compose..."
curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-\$(uname -s)-\$(uname -m)" -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose

echo "Installing Git..."
apt-get install -y git

echo "Cloning repository..."
cd /root
rm -rf options-trading-app || true
git clone https://github.com/yourusername/options-trading-app.git
cd options-trading-app

echo "Configuring environment..."
cp backend/.env.example backend/.env

# Update .env with provided values
sed -i "s/your_finnhub_api_key_here/$FINNHUB_KEY/" backend/.env
sed -i "s/NODE_ENV=development/NODE_ENV=production/" backend/.env

echo "Starting application..."
docker-compose -f docker-compose.prod.yml up -d --build

echo "Waiting for services..."
sleep 15

echo "Installing Nginx..."
apt-get install -y nginx certbot python3-certbot-nginx

echo "Application deployed successfully!"
echo "URL: http://$VPS_IP"
echo ""
echo "To setup domain with SSL:"
echo "  sudo certbot certonly --nginx -d $DOMAIN"

EOF

echo "✅ Deployment complete!"
echo ""
echo "Access your application at:"
echo "  http://$VPS_IP"
echo ""
echo "To setup SSL, SSH into VPS and run:"
echo "  sudo certbot certonly --nginx -d $DOMAIN"
