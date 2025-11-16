const express = require('express');
const app = express();
const { MongoClient } = require('mongodb');
const cors = require('cors');

app.use(cors());
app.use(express.json());

// ⚡️ Chaîne de connexion Atlas avec TLS, certificat contourné
const uri = "mongodb+srv://mezianimohamedabdelsamed_db_user:ZrC1a0ARpg5QdGSl@greenalgeriabase.mrvwbhl.mongodb.net/greenalgeriaDB?retryWrites=true&w=majority";

const client = new MongoClient(uri, {
    tls: true,
    tlsAllowInvalidCertificates: true, // <-- ignore les erreurs TLS
    serverSelectionTimeoutMS: 10000
});


app.post('/api/contributions', async (req, res) => {
    try {
        await client.connect();

        const db = client.db("greenalgeriaDB");
        const collection = db.collection("contributions");

        const data = req.body;
        const result = await collection.insertOne(data);

        res.json({ success: true, insertedId: result.insertedId });
    } catch (error) {
        console.error("Erreur MongoDB :", error);
        res.status(500).json({ success: false });
    }
});

app.listen(3000, () => console.log("Serveur lancé sur http://localhost:3000"));
