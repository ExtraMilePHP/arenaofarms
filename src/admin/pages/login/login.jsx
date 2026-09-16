import React, { useState } from 'react';
import { useDispatch } from 'react-redux';
import './LoginPage.css';
import { setSession } from '../../sessionSlice';
import { useNavigate } from 'react-router-dom';


const LoginPage = () => {
  const [password, setPassword] = useState('');
  const [error, setError]     = useState('');
  const dispatch = useDispatch();
  const navigate = useNavigate();  

  const handleSubmit = e => {
    e.preventDefault();

    if (password === 'milesplay') {
      console.log("Dispatching!!");
      dispatch(setSession({ sessionId: 'admin', organizationId: 'admin'}));
      navigate("/admin");
    } else {
      setError('Incorrect password');
    }
  };

  return (
    <div className="LoginPage_container">
      <form className="LoginPage_form" onSubmit={handleSubmit}>
        <h2 className="LoginPage_title">Superadmin Login</h2>
        {error && <div className="LoginPage_error">{error}</div>}
        
        <div className="LoginPage_field">
          <label className="LoginPage_label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            className="LoginPage_input"
            type="password"
            placeholder="Enter password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
          />
        </div>
        
        <button type="submit" className="LoginPage_button">
          Login
        </button>
      </form>
    </div>
  );
};

export default LoginPage;
