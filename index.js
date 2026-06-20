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
// dinamick routh 
    app.get("/api/artworks/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const query = { _id: new ObjectId(id) };
    const result = await artworksCollection.findOne(query);
    if (!result) {
      return res.status(404).json({ success: false, error: "Artwork not found" });
    }
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: "Invalid ID format or Server Error" });
  }
});



// 📤 ক) নির্দিষ্ট ইমেইলের ওপর ভিত্তি করে শুধুমাত্র ওই আর্টিস্টের আর্টওয়ার্কগুলো খোঁজা
app.get("/api/my-artworks", async (req, res) => {
  try {
    const email = req.query.email;
    if (!email) {
      return res.status(400).json({ success: false, error: "Email query param is required" });
    }
    const query = { artistEmail: email };
    const result = await artworksCollection.find(query).sort({ _id: -1 }).toArray();
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error("Error fetching user artworks:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// 🗑️ খ) আর্টওয়ার্ক ডিলিট করার এন্ডপয়েন্ট
app.delete("/api/artworks/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const query = { _id: new ObjectId(id) };
    const result = await artworksCollection.deleteOne(query);
    res.status(200).json(result); // { acknowledged: true, deletedCount: 1 }
  } catch (error) {
    res.status(500).json({ error: "Failed to delete artwork" });
  }
});

// 📝 গ) আর্টওয়ার্ক আপডেট (Edit) করার এন্ডপয়েন্ট
app.put("/api/artworks/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const updatedData = req.body;
    const filter = { _id: new ObjectId(id) };
    const updateDoc = {
      $set: {
        title: updatedData.title,
        description: updatedData.description,
        category: updatedData.category,
        price: Number(updatedData.price),
        image: updatedData.image,
      },
    };
    const result = await artworksCollection.updateOne(filter, updateDoc);
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: "Failed to update artwork" });
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