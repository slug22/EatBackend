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
                    const twentySeconds = 6000 * 1000; // milliseconds
  
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

  function executeSeleniumScript(orderId) {
    return new Promise((resolve, reject) => {
      const sideFilePath = path.join(__dirname, 'tacodrive.side');
      const command = `selenium-side-runner -c "browserName=chrome" ${sideFilePath} --params.orderId="${orderId}"`;
  
      exec(command, (error, stdout, stderr) => {
        if (error) {
          console.error(`Selenium execution error: ${error}`);
          return reject(error);
        }
        console.log(`Selenium stdout: ${stdout}`);
        console.error(`Selenium stderr: ${stderr}`);
        resolve(true);
      });
    });
  }
  
  async function executeSeleniumScript(orderItems) {
    const sideFilePath = path.join(__dirname, 'tacodrive.side');
    const baseCommand = `selenium-side-runner -c "browserName=chrome goog:chromeOptions.args=[--headless,--no-sandbox,--disable-dev-shm-usage]" ${sideFilePath}`;
  
    for (const item of orderItems) {
      const command = `${baseCommand} --params.itemUrl="${item.url}"`;
      
      try {
        console.log(`Executing Selenium command for ${item.name}: ${command}`);
        const { stdout, stderr } = await exec(command);
        console.log(`Selenium stdout: ${stdout}`);
        if (stderr) console.error(`Selenium stderr: ${stderr}`);
      } catch (error) {
        console.error(`Error executing Selenium for ${item.name}:`, error);
        throw error;
      }
    }
    
    return true;
  }
  //putki
  app.post('/api/confirm-payment', async (req, res) => {
    const { orderId } = req.body;
  
    try {
      const [rows] = await connection.execute('SELECT * FROM orders WHERE id = ?', [orderId]);
      if (rows.length === 0) {
        return res.status(404).json({ message: 'Order not found' });
      }
  
      const order = rows[0];
      const orderItems = JSON.parse(order.items);
  
      try {
        console.log(`Checking email for payment confirmation of $${order.total} for order ${orderId}...`);
        const emailConfirmation = await checkEmailForPayment(orderId, order.total);
        console.log('Final email confirmation result:', emailConfirmation);
  
        if (emailConfirmation) {
          // Payment confirmed, update order status
          await connection.execute('UPDATE orders SET status = ? WHERE id = ?', ['paid', orderId]);
  
          // Execute Selenium script
          console.log('Executing Selenium script for order automation...');
          try {
            await executeSeleniumScript(orderItems);
            await connection.execute('UPDATE orders SET status = ? WHERE id = ?', ['completed', orderId]);
            res.json({ message: 'Payment confirmed and order automated successfully' });
          } catch (seleniumError) {
            console.error('Error executing Selenium script:', seleniumError);
            await connection.execute('UPDATE orders SET status = ? WHERE id = ?', ['payment_confirmed_automation_failed', orderId]);
            res.status(500).json({ message: 'Payment confirmed but order automation failed', error: seleniumError.message });
          }
        } else {
          console.log('Payment not confirmed. No matching recent emails found.');
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

  //order save bitchesss
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