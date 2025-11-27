// server.js
const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// 🔹 Chaîne de connexion MongoDB Atlas
const uri = "mongodb+srv://mezianimohamedabdelsamed_db_user:ZrC1a0ARpg5QdGSl@greenalgeriabase.mrvwbhl.mongodb.net/greenalgeriaDB?retryWrites=true&w=majority";

const client = new MongoClient(uri, {
    tls: true,
    tlsAllowInvalidCertificates: true, // pour dev local
    serverSelectionTimeoutMS: 10000
});

let collection;

// 🔹 Connexion MongoDB au démarrage
async function startServer() {
    try {
        await client.connect();
        console.log("✅ MongoDB connecté");

        const db = client.db("greenalgeriaDB");
        collection = db.collection("contributions");

        // Démarrage serveur
        app.listen(3000, () => console.log("🚀 Serveur lancé sur http://localhost:3000"));
    } catch (err) {
        console.error("❌ Erreur de connexion MongoDB :", err.message);
    }
}

startServer();

// 🔹 Endpoint pour ajouter une contribution
app.post('/api/contributions', async (req, res) => {
    try {
        const data = req.body;
        if (!data || Object.keys(data).length === 0) {
            return res.status(400).json({ success: false, error: "Données vides" });
        }

        const result = await collection.insertOne(data);
        console.log("🌳 Contribution insérée :", result.insertedId);

        res.json({ success: true, insertedId: result.insertedId });
    } catch (error) {
        console.error("❌ Erreur MongoDB :", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});
