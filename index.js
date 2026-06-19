const dns = require("node:dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);

const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(
  cors({
    origin: "http://localhost:3000", 
    credentials: true,
  }),
);
app.use(express.json());

// MongoDB URI
const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect Database
    await client.connect();
    console.log("✅ Connected to MongoDB via Native Driver!");

    const db = client.db("artHub_DB");
    const usersCollection = db.collection("user");
    const artworksCollection = db.collection("artworks");
    const transactionsCollection = db.collection("transactions");
    const commentsCollection = db.collection("comments");

  
    // 📥 ১. POST Method: নতুন আর্টওয়ার্ক সেভ করা
   
    app.post("/api/artworks", async (req, res) => {
      try {
        const artworkData = req.body;
        
      
        if (!artworkData.title || !artworkData.image || !artworkData.artistEmail) {
          return res.status(400).json({ success: false, error: "Missing required fields" });
        }

    
        const result = await artworksCollection.insertOne({
          title: artworkData.title,
          description: artworkData.description,
          category: artworkData.category,
          price: Number(artworkData.price), 
          image: artworkData.image,
          artistName: artworkData.artistName,
          artistEmail: artworkData.artistEmail,
          createdAt: new Date()
        });

        res.status(201).json(result);

      } catch (error) {
        console.error("POST /api/artworks error:", error);
        res.status(500).json({ error: "Internal Server Error" });
      }
    });
    
    // 📤 ২. GET Method: 
    app.get("/api/artworks", async (req, res) => {
      try {
        // 
        const result = await artworksCollection.find({}).sort({ _id: -1 }).toArray();
        res.status(200).json({ success: true, data: result });
      } catch (error) {
        console.error("GET /api/artworks error:", error);
        res.status(500).json({ error: "Failed to fetch artworks" });
      }
    });

  } catch (error) {
    console.error("MongoDB Connection Error:", error);
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("🎨 ArtHub Server is running perfectly!");
});

app.listen(port, () => {
  console.log(`🚀 Server is flying on port ${port}`);
});