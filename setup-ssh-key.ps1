#!/usr/bin/env pwsh

##############################################################################
# SSH KEY SETUP - PowerShell
# 
# Purpose: Configure SSH key for VPS deployment
# Usage: .\setup-ssh-key.ps1
##############################################################################

$SSHDir = "$env:USERPROFILE\.ssh"
$SSHKeyPath = "$SSHDir\id_ed25519"
$Red = "`e[91m"
$Green = "`e[92m"
$Yellow = "`e[93m"
$Reset = "`e[0m"

Write-Host ""
Write-Host "$Yellow🔑 SSH Key Setup$Reset"
Write-Host "$Yellow==================$Reset"
Write-Host ""

# Create .ssh directory if it doesn't exist
if (-not (Test-Path $SSHDir)) {
    New-Item -ItemType Directory -Path $SSHDir -Force | Out-Null
    Write-Host "$Green✅ Created .ssh directory$Reset"
}

# Save the SSH key
$SSHKeyContent = @"
-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUtbm9uZS1ub25lAAAAAAAAAC0AAAALc3NoLWVk
MjU1MTkAAAAgRPxNWpkCbJBVmc/CHcpqNbyWSC/mnk6dNdUEh73eGH0AAAAohk8qOIZP
KjgAAAALc3NoLWVkMjU1MTkAAACA
-----END OPENSSH PRIVATE KEY-----
"@

# Note: The SSH key provided was only the public part, not the private key
# The user needs to add their actual PRIVATE key

Write-Host "$Yellow📝 IMPORTANT: Add your private SSH key$Reset"
Write-Host ""
Write-Host "You provided the public key, but we need the PRIVATE key."
Write-Host ""
Write-Host "To set up SSH:"
Write-Host ""
Write-Host "1. On your local machine, if you have the private key:"
Write-Host "   Copy your id_ed25519 file to: $SSHKeyPath"
Write-Host ""
Write-Host "2. If you don't have it, generate new keys:"
Write-Host "   ssh-keygen -t ed25519 -f '$SSHKeyPath' -N ''"
Write-Host ""
Write-Host "3. Then run the deployment script:"
Write-Host "   .\deploy-to-vps.ps1"
Write-Host ""

# Check if key exists
if (Test-Path $SSHKeyPath) {
    Write-Host "$Green✅ SSH key found at: $SSHKeyPath$Reset"
    
    # Set proper permissions (Windows)
    $Acl = Get-Acl $SSHKeyPath
    $Acl.SetAccessRuleProtection($true, $false)
    Set-Acl -Path $SSHKeyPath -AclObject $Acl
    Write-Host "$Green✅ SSH key permissions configured$Reset"
} else {
    Write-Host "$Yellow⚠️  SSH key not found. Please add it manually.$Reset"
}

Write-Host ""
