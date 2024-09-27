const express = require('express');
const bodyParser = require('body-parser');
const { exec } = require('child_process');
const path = require('path');
const mysql = require('mysql2/promise');

const app = express();
const port = 3000;

app.use(bodyParser.json());

// MySQL connection configuration
const dbConfig = {
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'EatBackend',
};

let connection;

async function initDatabase() {
  try {
    connection = await mysql.createConnection(dbConfig);
    console.log('Connected to MySQL database');

    // Create orders table if it doesn't exist
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

app.post('/api/order', async (req, res) => {
  const { order, total } = req.body;
  const orderId = Date.now().toString();
  const newOrder = { id: orderId, items: JSON.stringify(order), total, status: 'pending' };

  try {
    await connection.execute(
      'INSERT INTO orders (id, items, total, status) VALUES (?, ?, ?, ?)',
      [newOrder.id, newOrder.items, newOrder.total, newOrder.status]
    );
    res.json({ orderId, message: 'Order received' });
  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({ message: 'Error creating order' });
  }
});

app.get('/api/order/:id', async (req, res) => {
  try {
    const [rows] = await connection.execute('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    if (rows.length > 0) {
      const order = rows[0];
      order.items = JSON.parse(order.items);
      res.json(order);
    } else {
      res.status(404).json({ message: 'Order not found' });
    }
  } catch (error) {
    console.error('Error retrieving order:', error);
    res.status(500).json({ message: 'Error retrieving order' });
  }
});

app.post('/api/process-payment', async (req, res) => {
  const { orderId } = req.body;

  try {
    const [rows] = await connection.execute('SELECT * FROM orders WHERE id = ?', [orderId]);
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Assume venmo.side is in the same directory as the server file
    const sideFilePath = path.join(__dirname, 'venmo.side');

    exec(`selenium-side-runner ${sideFilePath}`, async (error, stdout, stderr) => {
      if (error) {
        console.error(`Execution error: ${error}`);
        return res.status(500).json({ message: 'Payment processing failed', error: error.message });
      }
      console.log(`Selenium output: ${stdout}`);
      console.error(`Selenium stderr: ${stderr}`);
      
      // Assuming the side file execution was successful if there's no error
      await connection.execute('UPDATE orders SET status = ? WHERE id = ?', ['paid', orderId]);
      res.json({ message: 'Payment processed successfully' });
    });
  } catch (error) {
    console.error('Error processing payment:', error);
    res.status(500).json({ message: 'Error processing payment' });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});