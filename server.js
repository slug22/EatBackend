const express = require('express');
const bodyParser = require('body-parser');
const { exec } = require('child_process');
const path = require('path');
const mysql = require('mysql2/promise');
const Imap = require('node-imap');
const simpleParser = require('mailparser').simpleParser;
const cors = require('cors');

const app = express();

// Enable CORS for all routes
app.use(cors({
  origin: ['http://localhost:8082', 'http://localhost:19006', 'http://10.0.2.2:19006'] // Allow requests from your Expo app
}));

app.use(bodyParser.json());

// MySQL connection configuration
const dbConfig = {
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'EatBackend',
};

const imapConfig = {
  user: 'simongage0@gmail.com',
  password: 'llaq eenx gjjl mvaq',
  host: 'imap.gmail.com', // Changed from localhost to Gmail's IMAP server
  port: 993,
  tls: true,
};

let connection;

async function initDatabase() {
  try {
    connection = await mysql.createConnection(dbConfig);
    console.log('Connected to MySQL database');

    await connection.execute(`
      CREATE TABLE IF NOT EXISTS orders (
        id VARCHAR(255) PRIMARY KEY,
        items JSON,
        total DECIMAL(10, 2),
        status VARCHAR(50)
      )
    `);
    console.log('Orders table created or already exists');
  } catch (error) {
    console.error('Error connecting to database:', error);
    process.exit(1);
  }
}

initDatabase();





function checkEmailForPayment(orderId, expectedAmount) {
    return new Promise((resolve, reject) => {
      const imap = new Imap(imapConfig);
  
      imap.once('ready', () => {
        imap.openBox('INBOX', false, (err, box) => {
          if (err) {
            console.error('Error opening inbox:', err);
            imap.end();
            return reject(err);
          }
  
          // Search for emails with the expected amount in the subject
          const searchCriteria = ['UNSEEN', ['SUBJECT', `$${expectedAmount}`]];
          const fetchOptions = { bodies: ['HEADER', 'TEXT'], markSeen: false };
  
          imap.search(searchCriteria, (searchErr, results) => {
            if (searchErr) {
              console.error('Error searching emails:', searchErr);
              imap.end();
              return reject(searchErr);
            }
  
            if (results.length === 0) {
              console.log(`No emails found with $${expectedAmount} in the subject`);
              console.log(expectedAmount);
              imap.end();
              return resolve(false);
            }
  
            console.log(`Found ${results.length} email(s) with $${expectedAmount} in the subject`);
  
            const f = imap.fetch(results, fetchOptions);
            f.on('message', (msg) => {
              msg.on('body', (stream) => {
                simpleParser(stream, (parseErr, parsed) => {
                  if (parseErr) {
                    console.error('Error parsing email:', parseErr);
                    return;
                  }
  
                  console.log('Parsed email subject:', parsed.subject);
                  console.log('Parsed email date:', parsed.date);
  
                  // Check if the email is recent (within the last hour)
                  const emailDate = new Date(parsed.date);
                  const now = new Date();
                  const timeDifference = now - emailDate;
                  const oneHour =  60 * 1000; // milliseconds
  
                  if (timeDifference <= oneHour) {
                    console.log('Recent email found with matching amount');
                    resolve(true);
                  } else {
                    console.log('Matching email found, but it\'s older than one hour');
                  }
                });
              });
            });
  
            f.once('error', (fetchErr) => {
              console.error('Error fetching email:', fetchErr);
              imap.end();
              reject(fetchErr);
            });
  
            f.once('end', () => {
              console.log('Finished checking emails');
              imap.end();
              resolve(false);
            });
          });
        });
      });
  
      imap.once('error', (err) => {
        console.error('IMAP connection error:', err);
        reject(err);
      });
  
      imap.once('end', () => {
        console.log('IMAP connection ended');
      });
  
      imap.connect();
    });
  }

  app.post('/api/confirm-payment', async (req, res) => {
    const { orderId } = req.body;
  
    try {
      const [rows] = await connection.execute('SELECT * FROM orders WHERE id = ?', [orderId]);
      if (rows.length === 0) {
        return res.status(404).json({ message: 'Order not found' });
      }
  
      const order = rows[0];
  
      try {
        console.log(`Checking email for payment confirmation of $${order.total} for order ${orderId}...`);
        const emailConfirmation = await checkEmailForPayment(orderId, order.total);
        console.log('Email confirmation result:', emailConfirmation);
  
        if (emailConfirmation) {
          // Payment confirmed, update order status
          await connection.execute('UPDATE orders SET status = ? WHERE id = ?', ['paid', orderId]);
          res.json({ message: 'Payment confirmed successfully' });
        } else {
          res.status(402).json({ message: 'Payment not confirmed. Please check your payment and try again.' });
        }
      } catch (emailError) {
        console.error('Error checking email:', emailError);
        res.status(500).json({ message: 'Error confirming payment', error: emailError.message });
      }
    } catch (error) {
      console.error('Error processing payment confirmation:', error);
      res.status(500).json({ message: 'Error processing payment confirmation' });
    }
  });


  //ordersave
  app.post('/api/save-order', async (req, res) => {
      const { order, total } = req.body;
      const orderId = Date.now().toString();
      const status = 'pending';
    
      try {
        await connection.execute(
          'INSERT INTO orders (id, items, total, status) VALUES (?, ?, ?, ?)',
          [orderId, JSON.stringify(order), total, status]
        );
        res.json({ orderId, message: 'Order saved successfully' });
      } catch (error) {
        console.error('Error saving order:', error);
        res.status(500).json({ message: 'Error saving order' });
      }
    });

app.listen(3000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:3000');
});