const axios = require('axios');

const sendEmail = async ({ email, subject, html, text }) => {
  if (!process.env.BREVO_API_KEY || !process.env.EMAIL_FROM) {
    const error = new Error('Email delivery is not configured');
    error.statusCode = 503;
    throw error;
  }
  try {
    const response = await axios.post(
      'https://api.brevo.com/v3/smtp/email',
      {
        sender: { email: process.env.EMAIL_FROM, name: 'Build With Me' },
        to: [{ email }],
        subject,
        htmlContent: html,
        textContent: text,
      },
      {
        headers: {
          'api-key': process.env.BREVO_API_KEY,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );
    return response.data;
  } catch (error) {
    console.error('Brevo email delivery failed:', error.response?.status || error.code || 'unknown');
    const deliveryError = new Error('Email sending failed');
    deliveryError.statusCode = 502;
    throw deliveryError;
  }
};

module.exports = { sendEmail };
