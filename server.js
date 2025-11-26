// server.js
const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Servir les fichiers HTML/CSS/JS sur Render
app.use(express.static(__dirname));

// Connexion MongoDB
const uri = "mongodb+srv://mezianimohamedabdelsamed_db_user:ZrC1a0ARpg5QdGSl@greenalgeriabase.mrvwbhl.mongodb.net/greenalgeriaDB?retryWrites=true&w=majority";

const client = new MongoClient(uri, {
    tls: true,
    tlsAllowInvalidCertificates: true,
    serverSelectionTimeoutMS: 10000
});

let collection;

// Démarrer serveur + MongoDB
async function startServer() {
    try {
        await client.connect();
        console.log("MongoDB connecté");

        const db = client.db("greenalgeriaDB");
        collection = db.collection("contributions");

        const PORT = process.env.PORT || 3000;
        app.listen(PORT, () => console.log("Server running on port " + PORT));

    } catch (err) {
        console.error("Erreur MongoDB :", err.message);
    }
}

startServer();

// API : Ajouter une contribution
app.post('/api/contributions', async (req, res) => {
    try {
        const data = req.body;
        const result = await collection.insertOne(data);

        res.json({ success: true, insertedId: result.insertedId });
    } catch (error) {
        console.error("Erreur :", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});
j'ai 