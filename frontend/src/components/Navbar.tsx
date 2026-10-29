import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import '../styles/navbar.css';

const Navbar: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <nav className="navbar">
      <div className="navbar-container">
        <Link to="/" className="navbar-logo">
          <span className="logo-icon">📈</span>
          Trading Pro
        </Link>

        <div className="navbar-menu">
          <Link to="/" className="nav-link">
            Dashboard
          </Link>
          <Link to="/scanner" className="nav-link">
            Scanner
          </Link>
          <Link to="/portfolio" className="nav-link">
            Portfolio
          </Link>
        </div>

        <div className="navbar-actions">
          <button className="btn-primary">Connect Wallet</button>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
