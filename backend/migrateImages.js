// migrateImages.js - Script de migration des images Base64 vers fichiers
const { MongoClient, ObjectId } = require('mongodb');
const fs = require('fs');
const path = require('path');

// 🔹 Configuration MongoDB
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://abdessamed:abdessamed@cluster0.7j0yq.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';
const DB_NAME = 'greenalgeriaDB';
const COLLECTION_NAME = 'contributions';

// 🔹 Dossier de destination pour les images
const STATIC_IMAGES_DIR = path.join(__dirname, 'static', 'images');

// Créer le dossier s'il n'existe pas
if (!fs.existsSync(STATIC_IMAGES_DIR)) {
    fs.mkdirSync(STATIC_IMAGES_DIR, { recursive: true });
    console.log(`📁 Dossier créé : ${STATIC_IMAGES_DIR}`);
}

/**
 * Convertit une image Base64 en fichier binaire
 * @param {string} base64String - L'image en format Base64 (ex: "data:image/jpeg;base64,..." ou "data:application/octet-stream;base64,...")
 * @param {string} outputPath - Le chemin complet du fichier de sortie
 */
function saveBase64ToFile(base64String, outputPath) {
    // Extraire les données Base64 pures (gère data:image/*, data:application/*, etc.)
    // Format attendu: data:<type>/<subtype>;base64,<données>
    const matches = base64String.match(/^data:([^\/]+)\/([^;]+);base64,(.+)$/);
    
    if (!matches || matches.length !== 4) {
        throw new Error('Format Base64 invalide - format attendu: data:<type>/<subtype>;base64,<données>');
    }
    
    const mimeType = matches[1]; // image, application, etc.
    const subType = matches[2]; // jpeg, png, octet-stream, etc.
    const base64Data = matches[3];
    
    // Convertir en buffer binaire et sauvegarder
    const buffer = Buffer.from(base64Data, 'base64');
    fs.writeFileSync(outputPath, buffer);
    
    return `${mimeType}/${subType}`; // Retourne le type MIME complet
}

/**
 * Migration principale
 */
async function migrateImages() {
    const client = new MongoClient(MONGO_URI);
    
    try {
        console.log('🔌 Connexion à MongoDB...');
        await client.connect();
        console.log('✅ Connecté à MongoDB');
        
        const db = client.db(DB_NAME);
        const collection = db.collection(COLLECTION_NAME);
        
        // Trouver tous les documents avec des images Base64
        console.log('🔍 Recherche des images Base64...');
        const documentsWithBase64 = await collection.find({
            photo: { $regex: '^data:' }
        }).toArray();
        
        console.log(`📊 ${documentsWithBase64.length} images Base64 trouvées`);
        
        let migratedCount = 0;
        let errorCount = 0;
        
        for (const doc of documentsWithBase64) {
            try {
                const docId = doc._id.toString();
                console.log(`\n🔄 Migration de l'image pour le document ${docId}...`);
                
                // Extraire le type d'image et sauvegarder
                const imageType = saveBase64ToFile(
                    doc.photo,
                    path.join(STATIC_IMAGES_DIR, `${docId}.jpg`) // On force .jpg pour uniformiser
                );
                
                // Nouvelle URL relative
                const newPhotoUrl = `/static/images/${docId}.jpg`;
                
                // Mettre à jour le document dans MongoDB
                const updateResult = await collection.updateOne(
                    { _id: doc._id },
                    { 
                        $set: { 
                            photo: newPhotoUrl,
                            migratedAt: new Date(),
                            originalFormat: imageType
                        } 
                    }
                );
                
                if (updateResult.modifiedCount === 1) {
                    console.log(`✅ Document ${docId} migré avec succès`);
                    console.log(`   Ancienne URL : data:${imageType};base64,...`);
                    console.log(`   Nouvelle URL : ${newPhotoUrl}`);
                    migratedCount++;
                } else {
                    console.warn(`⚠️  Document ${docId} : Mise à jour échouée`);
                    errorCount++;
                }
                
            } catch (error) {
                console.error(`❌ Erreur pour le document ${doc._id}:`, error.message);
                errorCount++;
            }
        }
        
        console.log('\n' + '='.repeat(60));
        console.log('📈 RAPPORT DE MIGRATION');
        console.log('='.repeat(60));
        console.log(`✅ Images migrées avec succès : ${migratedCount}`);
        console.log(`❌ Erreurs rencontrées : ${errorCount}`);
        console.log(`📁 Dossier de destination : ${STATIC_IMAGES_DIR}`);
        console.log('='.repeat(60));
        
    } catch (error) {
        console.error('❌ Erreur fatale lors de la migration :', error);
    } finally {
        await client.close();
        console.log('\n🔌 Connexion MongoDB fermée');
    }
}

// Lancer la migration
console.log('🚀 Démarrage de la migration des images...\n');
migrateImages()
    .then(() => {
        console.log('\n✅ Migration terminée avec succès');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n❌ La migration a échoué :', error);
        process.exit(1);
    });

