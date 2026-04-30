require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Vercel /tmp directory bypass for SQLite
const dbPath = process.env.VERCEL ? '/tmp/jkcabs.db' : path.join(__dirname, 'jkcabs.db');

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error('DB Connection Error:', err.message);
    else console.log('Connected to SQLite at ' + dbPath);
});

// Create tables synchronously to prevent errors
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS drivers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, phone TEXT, vehicle TEXT, status TEXT DEFAULT 'Available')`);
    db.run(`CREATE TABLE IF NOT EXISTS fleet (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, type TEXT, price TEXT, img TEXT, seats TEXT, trans TEXT, fuel TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS bookings (id INTEGER PRIMARY KEY AUTOINCREMENT, trip_type TEXT, pickup TEXT, dropoff TEXT, vehicle TEXT, customer_email TEXT, customer_phone TEXT, customer_name TEXT, extra_details TEXT, status TEXT DEFAULT 'Pending', tracking_id TEXT, assigned_driver TEXT, driver_phone TEXT, current_lat REAL, current_lng REAL, live_speed REAL)`);
    db.run(`CREATE TABLE IF NOT EXISTS customers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email TEXT UNIQUE, phone TEXT, password TEXT)`);

    // Seed Fleet
    db.get("SELECT COUNT(*) as count FROM fleet", (err, row) => {
        if (row && row.count === 0) {
            const stmt = db.prepare(`INSERT INTO fleet (name, type, price, img, seats, trans, fuel) VALUES (?, ?, ?, ?, ?, ?, ?)`);
            const cars = [
                ["Hatchback (Maruti Swift)", "Hatchback", "₹2000", "https://images.unsplash.com/photo-1517524008436-bbdb53c07ed7?auto=format&fit=crop&w=800", "4 Seats", "Manual", "Petrol/Diesel"],
                ["Sedan (Swift Dzire)", "Sedan", "₹2500", "https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?auto=format&fit=crop&w=800", "4 Seats", "Manual/Auto", "Petrol/Diesel"],
                ["Premium SUV (Innova Crysta)", "Premium SUV", "₹5000", "https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?auto=format&fit=crop&w=800", "7 Seats", "Manual/Auto", "Diesel"],
                ["Group Van (Tempo Traveller)", "Van", "₹7000", "https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?auto=format&fit=crop&w=800", "17 Seats", "Manual", "Diesel"]
            ];
            cars.forEach(c => stmt.run(c));
            stmt.finalize();
        }
    });
});

// CUSTOMER LOGIN SYSTEM
app.post('/api/customer/signup', (req, res) => {
    const { name, email, phone, password } = req.body;
    db.run(`INSERT INTO customers (name, email, phone, password) VALUES (?, ?, ?, ?)`, [name, email, phone, password], function(err) {
        if (err) return res.status(400).json({ error: "Email already exists or Database Error." });
        res.json({ success: true, name, email, phone });
    });
});

app.post('/api/customer/login', (req, res) => {
    const { email, password } = req.body;
    db.get(`SELECT * FROM customers WHERE email = ? AND password = ?`, [email, password], (err, row) => {
        if (err) return res.status(500).json({ error: "Database error." });
        if (!row) return res.status(401).json({ error: "Invalid Email or Password." });
        res.json({ success: true, name: row.name, email: row.email, phone: row.phone });
    });
});

app.get('/api/customer/bookings/:email', (req, res) => db.all(`SELECT * FROM bookings WHERE customer_email = ? ORDER BY id DESC`, [req.params.email], (err, rows) => res.json(rows || [])));

// ADMIN & GENERAL APIs
app.post('/api/admin/login', (req, res) => {
    const secureUser = process.env.ADMIN_USERNAME || 'Admin';
    const securePass = process.env.ADMIN_PASSWORD || 'JKcabs@123';
    if (req.body.username === secureUser && req.body.password === securePass) res.json({ success: true });
    else res.status(401).json({ error: "Unauthorized" });
});

app.get('/api/fleet', (req, res) => db.all(`SELECT * FROM fleet`, (err, rows) => res.json(rows || [])));
app.get('/api/drivers', (req, res) => db.all(`SELECT * FROM drivers`, (err, rows) => res.json(rows || [])));
app.get('/api/admin/bookings', (req, res) => db.all(`SELECT * FROM bookings ORDER BY id DESC`, (err, rows) => res.json(rows || [])));
app.get('/api/track/:tracking_id', (req, res) => db.get(`SELECT * FROM bookings WHERE tracking_id = ?`, [req.params.tracking_id], (err, row) => res.json(row || {error: "Not Found"})));

app.post('/api/book', (req, res) => {
    const { trip_type, pickup, dropoff, vehicle, customer_email, customer_phone, customer_name, extra_details } = req.body;
    db.run(`INSERT INTO bookings (trip_type, pickup, dropoff, vehicle, customer_email, customer_phone, customer_name, extra_details) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, 
    [trip_type, pickup, dropoff, vehicle, customer_email, customer_phone, customer_name, extra_details], function(err) {
        if(err) return res.status(500).json({error: err.message});
        res.json({ bookingId: this.lastID });
    });
});

app.post('/api/admin/confirm-booking', (req, res) => {
    const { id, driver_name, driver_phone } = req.body;
    const tracking_id = `TRK-${id}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    db.run(`UPDATE bookings SET status = 'Confirmed', assigned_driver = ?, driver_phone = ?, tracking_id = ? WHERE id = ?`, [driver_name, driver_phone, tracking_id, id], (err) => {
        if(err) return res.status(500).json({error: err.message});
        res.json({ tracking_id });
    });
});

app.post('/api/admin/add/:table', (req, res) => {
    const { name, phone, vehicle, type, price, img, seats, trans, fuel } = req.body;
    if(req.params.table === 'driver') db.run(`INSERT INTO drivers (name, phone, vehicle) VALUES (?, ?, ?)`, [name, phone, vehicle], () => res.json({success: true}));
    else db.run(`INSERT INTO fleet (name, type, price, img, seats, trans, fuel) VALUES (?, ?, ?, ?, ?, ?, ?)`, [name, type, price, img, seats, trans, fuel], () => res.json({success: true}));
});

app.delete('/api/admin/delete/:table/:id', (req, res) => db.run(`DELETE FROM ${req.params.table} WHERE id = ?`, [req.params.id], () => res.json({success: true})));

// VERCEL EXPORT
if (process.env.NODE_ENV !== 'production') app.listen(PORT, () => console.log(`🚀 Server live on http://localhost:${PORT}`));
module.exports = app;