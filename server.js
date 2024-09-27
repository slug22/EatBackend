
const express = require('express');
const bodyParser = require('body-parser');
const { exec } = require('child_process');
const util = require('util');
const path = require('path');
const mysql = require('mysql2/promise');
const Imap = require('node-imap');
const simpleParser = require('mailparser').simpleParser;
const cors = require('cors');
const fs = require('fs').promises;

const execPromise = util.promisify(exec);

const app = express();

// Enable CORS for all routes
app.use(cors({
  origin: ['http://localhost:8082', 'http://localhost:19006', 'http://10.0.2.2:19006']
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


// Load JSON sections
const sections = {
    addToCart: require('./addCart.json'),
    setLocation: require('./locate.json'),
    checkout: require('./checkOut.json')
  };
  
 // ... (previous code remains the same)

function generateSeleniumScript(items, location, userName) {
    console.log('Generating Selenium script with:', { items, location, userName });
  
    const script = {
      id: "dynamic-taco-bell-order",
      version: "2.0",
      name: "Dynamic Taco Bell Order",
      url: "https://www.tacobell.com",
      tests: [{
        id: "main-test",
        name: "Order and Checkout",
        commands: []
      }],
      suites: [{
        id: "main-suite",
        name: "Main Suite",
        persistSession: false,
        parallel: false,
        timeout: 300,
        tests: ["main-test"]
      }]
    };
  
    // Add items to cart
    items.forEach(item => {
      console.log('Processing item:', item);
      if (Array.isArray(sections.addToCart)) {
        const itemCommands = JSON.parse(JSON.stringify(sections.addToCart));
        const urlCommand = itemCommands.find(cmd => cmd.command === "open");
        if (urlCommand) {
          urlCommand.target = item.url;
        }
        script.tests[0].commands.push(...itemCommands);
      } else {
        console.error('sections.addToCart is not an array:', sections.addToCart);
      }
    });
  
    // Set location
    if (Array.isArray(sections.setLocation)) {
      const locationCommands = JSON.parse(JSON.stringify(sections.setLocation));
      const enterLocationCommand = locationCommands.find(cmd => cmd.id === "enter-location");
      if (enterLocationCommand) {
        enterLocationCommand.value = location;
      }
      script.tests[0].commands.push(...locationCommands);
    } else {
      console.error('sections.setLocation is not an array:', sections.setLocation);
    }
  
    // Checkout process
    if (Array.isArray(sections.checkout)) {
      const checkoutCommands = JSON.parse(JSON.stringify(sections.checkout));
      const enterNameCommand = checkoutCommands.find(cmd => cmd.id === "enter-name");
      if (enterNameCommand) {
        enterNameCommand.value = userName;
      }
      script.tests[0].commands.push(...checkoutCommands);
    } else {
      console.error('sections.checkout is not an array:', sections.checkout);
    }
  
    console.log('Generated script:', script);
    return JSON.stringify(script, null, 2);
  }
  
  // ... (rest of the code remains the same)

//nunu
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
              imap.end();
              return resolve(false);
            }
  
            console.log(`Found ${results.length} email(s) with $${expectedAmount} in the subject`);
  
            const emailPromises = [];
  
            const f = imap.fetch(results, fetchOptions);
            f.on('message', (msg) => {
              const emailPromise = new Promise((resolveEmail) => {
                msg.on('body', (stream) => {
                  simpleParser(stream, (parseErr, parsed) => {
                    if (parseErr) {
                      console.error('Error parsing email:', parseErr);
                      resolveEmail(false);
                      return;
                    }
  
                    console.log('Parsed email subject:', parsed.subject);
                    console.log('Parsed email date:', parsed.date);
  
                    // Check if the email is recent (within the last 20 seconds)
                    const emailDate = new Date(parsed.date);
                    const now = new Date();
                    const timeDifference = now - emailDate;
                    const twentySeconds = 60000 * 1000; // milliseconds
  
                    resolveEmail(timeDifference <= twentySeconds);
                  });
                });
              });
              emailPromises.push(emailPromise);
            });
  
            f.once('error', (fetchErr) => {
              console.error('Error fetching email:', fetchErr);
              imap.end();
              reject(fetchErr);
            });
  
            f.once('end', () => {
              console.log('Finished fetching emails');
              Promise.all(emailPromises).then((results) => {
                imap.end();
                const foundValidEmail = results.some(result => result === true);
                console.log('Email confirmation result:', foundValidEmail);
                resolve(foundValidEmail);
              });
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
      const orderItems = JSON.parse(order.items);
  
      console.log(`Checking email for payment confirmation of $${order.total} for order ${orderId}...`);
      const emailConfirmation = await checkEmailForPayment(orderId, order.total);
      console.log('Final email confirmation result:', emailConfirmation);
  
      if (emailConfirmation) {
        await connection.execute('UPDATE orders SET status = ? WHERE id = ?', ['paid', orderId]);
  
        console.log('Executing Selenium script for order automation...');
        try {
          await generateSeleniumScript(orderItems, order.userName, order.location);
          await connection.execute('UPDATE orders SET status = ? WHERE id = ?', ['completed', orderId]);
          res.json({ message: 'Payment confirmed and order automated successfully' });
        } catch (seleniumError) {
          console.error('Error executing Selenium script:', seleniumError);
          await connection.execute('UPDATE orders SET status = ? WHERE id = ?', ['payment_confirmed_automation_failed', orderId]);
          if (seleniumError.message.includes('Network error')) {
            res.status(503).json({ message: 'Payment confirmed but order automation failed due to network issues', error: seleniumError.message });
          } else {
            res.status(500).json({ message: 'Payment confirmed but order automation failed', error: seleniumError.message });
          }
        }
      } else {
        console.log('Payment not confirmed. No matching recent emails found.');
        res.status(402).json({ message: 'Payment not confirmed. Please check your payment and try again.' });
      }
    } catch (error) {
      console.error('Error processing payment confirmation:', error);
      if (error.message.includes('HTTP')) {
        res.status(503).json({ message: 'Error processing payment confirmation due to network issues', error: error.message });
      } else {
        res.status(500).json({ message: 'Error processing payment confirmation', error: error.message });
      }
    }
  });
  // Make sure to update the save-order endpoint to not include email
  app.post('/api/save-order', async (req, res) => {
    const { order, total, location, userName } = req.body;
    const orderId = Date.now().toString();
    const status = 'pending';
  
    try {
      await connection.execute(
        'INSERT INTO orders (id, items, total, status, location, userName) VALUES (?, ?, ?, ?, ?, ?)',
        [orderId, JSON.stringify(order), total, status, location, userName]
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