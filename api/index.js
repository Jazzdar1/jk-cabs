require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());

// CONNECT TO NEON CLOUD DATABASE
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// INITIALIZE CLOUD DATABASE AND TABLES
const initDB = async () => {
    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS drivers (id SERIAL PRIMARY KEY, name TEXT, phone TEXT, vehicle TEXT, status TEXT DEFAULT 'Available')`);
        await pool.query(`CREATE TABLE IF NOT EXISTS fleet (id SERIAL PRIMARY KEY, name TEXT, type TEXT, price TEXT, img TEXT, seats TEXT, trans TEXT, fuel TEXT)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS bookings (id SERIAL PRIMARY KEY, trip_type TEXT, pickup TEXT, dropoff TEXT, vehicle TEXT, customer_email TEXT, customer_phone TEXT, customer_name TEXT, extra_details TEXT, status TEXT DEFAULT 'Pending', tracking_id TEXT, assigned_driver TEXT, driver_phone TEXT, current_lat REAL, current_lng REAL, live_speed REAL)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS customers (id SERIAL PRIMARY KEY, name TEXT, email TEXT UNIQUE, phone TEXT, password TEXT)`);

        // PERMANENT VIP LOGIN (Failsafe)
        await pool.query(`INSERT INTO customers (name, email, phone, password) VALUES ('VIP Customer', 'test@jkcabs.com', '7006268328', '12345') ON CONFLICT (email) DO NOTHING`);

        // SEED INVENTORY IF EMPTY
        const res = await pool.query("SELECT COUNT(*) FROM fleet");
        if (parseInt(res.rows[0].count) === 0) {
            const cars = [
                ["Hatchback (Maruti Swift)", "Hatchback", "₹2000", "https://images.unsplash.com/photo-1517524008436-bbdb53c07ed7?auto=format&fit=crop&w=800", "4 Seats", "Manual", "Petrol/Diesel"],
                ["Sedan (Swift Dzire)", "Sedan", "₹2500", "https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?auto=format&fit=crop&w=800", "4 Seats", "Manual/Auto", "Petrol/Diesel"],
                ["Premium SUV (Innova)", "Premium SUV", "₹5000", "https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?auto=format&fit=crop&w=800", "7 Seats", "Manual/Auto", "Diesel"],
                ["Group Van (Tempo)", "Van", "₹7000", "https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?auto=format&fit=crop&w=800", "17 Seats", "Manual", "Diesel"],
                ["Luxury SUV (Fortuner)", "Luxury", "₹9000", "https://images.unsplash.com/photo-1620021614217-1f481c5d9888?auto=format&fit=crop&w=800", "7 Seats", "Automatic", "Diesel"]
            ];
            for (let c of cars) {
                await pool.query(`INSERT INTO fleet (name, type, price, img, seats, trans, fuel) VALUES ($1, $2, $3, $4, $5, $6, $7)`, c);
            }
        }
        console.log("🟢 Neon Cloud Database Connected Successfully!");
    } catch (err) {
        console.error("🔴 Database Initialization Error:", err.message);
    }
};
initDB();

// ==========================================
// FULL API ROUTES 
// ==========================================

// ADMIN LOGIN ROUTE
app.post('/api/admin/login', (req, res) => {
    const user = process.env.ADMIN_USERNAME || 'Admin';
    const pass = process.env.ADMIN_PASSWORD || 'JKcabs@123';
    if (req.body.username === user && req.body.password === pass) return res.json({ success: true });
    res.status(401).json({ error: "Unauthorized Access" });
});

// CUSTOMER REGISTRATION
app.post('/api/customer/signup', async (req, res) => {
    try {
        const { name, email, phone, password } = req.body;
        await pool.query(`INSERT INTO customers (name, email, phone, password) VALUES ($1, $2, $3, $4)`, [name, email, phone, password]);
        res.json({ success: true, name, email, phone });
    } catch(err) {
        res.status(400).json({ error: "Email already registered in system!" });
    }
});

// CUSTOMER LOGIN
app.post('/api/customer/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const result = await pool.query(`SELECT * FROM customers WHERE email = $1 AND password = $2`, [email, password]);
        if (result.rows.length === 0) return res.status(401).json({ error: "Invalid Email or Password" });
        res.json({ success: true, name: result.rows[0].name, email: result.rows[0].email, phone: result.rows[0].phone });
    } catch (err) {
        res.status(500).json({ error: "Database Connection Failed." });
    }
});

// DATA FETCH ROUTES
app.get('/api/fleet', async (req, res) => { 
    const result = await pool.query(`SELECT * FROM fleet`); 
    res.json(result.rows); 
});

app.get('/api/drivers', async (req, res) => { 
    const result = await pool.query(`SELECT * FROM drivers`); 
    res.json(result.rows); 
});

app.get('/api/admin/bookings', async (req, res) => { 
    const result = await pool.query(`SELECT * FROM bookings ORDER BY id DESC`); 
    res.json(result.rows); 
});

app.get('/api/customer/bookings/:email', async (req, res) => { 
    const result = await pool.query(`SELECT * FROM bookings WHERE customer_email = $1 ORDER BY id DESC`, [req.params.email]); 
    res.json(result.rows); 
});

app.get('/api/track/:tracking_id', async (req, res) => {
    const result = await pool.query(`SELECT * FROM bookings WHERE tracking_id = $1`, [req.params.tracking_id]);
    res.json(result.rows.length > 0 ? result.rows[0] : {error: "Tracking ID Not Found"});
});

// BOOKING MANAGEMENT
app.post('/api/book', async (req, res) => {
    const { trip_type, pickup, dropoff, vehicle, customer_email, customer_phone, customer_name, extra_details } = req.body;
    try {
        const result = await pool.query(`INSERT INTO bookings (trip_type, pickup, dropoff, vehicle, customer_email, customer_phone, customer_name, extra_details) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`, 
        [trip_type, pickup, dropoff, vehicle, customer_email, customer_phone, customer_name, extra_details]);
        res.json({ bookingId: result.rows[0].id });
    } catch(e) { 
        res.status(500).json({error: e.message}); 
    }
});

app.post('/api/admin/confirm-booking', async (req, res) => {
    const { id, driver_name, driver_phone } = req.body;
    const tracking_id = `TRK-${id}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    try {
        await pool.query(`UPDATE bookings SET status = 'Confirmed', assigned_driver = $1, driver_phone = $2, tracking_id = $3 WHERE id = $4`, [driver_name, driver_phone, tracking_id, id]);
        res.json({ tracking_id });
    } catch(e) { 
        res.status(500).json({error: e.message}); 
    }
});

// GPS DRIVER UPDATE
app.post('/api/driver/update-location', async (req, res) => {
    try {
        const { tracking_id, lat, lng, speed } = req.body;
        await pool.query(`UPDATE bookings SET current_lat = $1, current_lng = $2, live_speed = $3 WHERE tracking_id = $4`, [lat, lng, speed, tracking_id]);
        res.json({ success: true });
    } catch(e) {
        res.status(500).json({error: e.message});
    }
});

// INVENTORY ADDITION & DELETION
app.post('/api/admin/add/:table', async (req, res) => {
    const { name, phone, vehicle, type, price, img, seats, trans, fuel } = req.body;
    if(req.params.table === 'driver') {
        await pool.query(`INSERT INTO drivers (name, phone, vehicle) VALUES ($1, $2, $3)`, [name, phone, vehicle]);
    } else {
        await pool.query(`INSERT INTO fleet (name, type, price, img, seats, trans, fuel) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [name, type, price, img, seats, trans, fuel]);
    }
    res.json({success: true});
});

app.delete('/api/admin/delete/:table/:id', async (req, res) => {
    const table = req.params.table === 'fleet' ? 'fleet' : (req.params.table === 'drivers' || req.params.table === 'driver' ? 'drivers' : 'bookings');
    await pool.query(`DELETE FROM ${table} WHERE id = $1`, [req.params.id]);
    res.json({success: true});
});

// VERCEL EXPORT (Strictly Required for Serverless)
module.exports = app;