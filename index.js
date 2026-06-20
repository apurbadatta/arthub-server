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

    // ১. POST Method:
    app.post("/api/artworks", async (req, res) => {
      try {
        const artworkData = req.body;
        
        if (!artworkData.title || !artworkData.image || !artworkData.artistEmail) {
          return res.status(400).json({ success: false, error: "Missing required fields" });
        }

        const currentCount = await artworksCollection.countDocuments({ artistEmail: artworkData.artistEmail });
        const artistUser = await usersCollection.findOne({ email: artworkData.artistEmail });
        const userTier = artistUser?.tier || "free"; // ডিফল্ট 'free'

        if (userTier === "free" && currentCount >= 3) {
          return res.status(403).json({ 
            success: false, 
            error: "Limit Reached! standard accounts are limited to 3 artworks. Please upgrade your subscription tier." 
          });
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

    // পেমেন্ট সফল হওয়ার পর ইউজারকে প্রিমিয়ামে রূপান্তর করার এবং ট্রানজেকশন ডাটা সেভ করার রুট
    app.put("/api/profile/upgrade-premium", async (req, res) => {
      try {
        const { email, amount, paymentIntentId } = req.body;

        if (!email) {
          return res.status(400).json({ success: false, message: "Email is required to upgrade profile." });
        }

        const filter = { email: email };
        const updateDoc = {
          $set: {
            isPremium: true,
            tier: "premium", 
            updatedAt: new Date()
          },
        };

        const result = await usersCollection.updateOne(filter, updateDoc);
        
        // ট্রানজেকশন হিস্টোরি সেভ করা হচ্ছে
        const transactionDoc = {
          email: email,
          amount: Number(amount) || 49.00,
          transactionId: paymentIntentId || `TXN_${Date.now()}`,
          packageName: "Premium Tier Upgrade",
          date: new Date()
        };
        await transactionsCollection.insertOne(transactionDoc);
        
        if (result.modifiedCount > 0 || result.matchedCount > 0) {
          res.status(200).json({ success: true, message: "Account upgraded to Premium and transaction recorded successfully!" });
        } else {
          res.status(404).json({ success: false, message: "User not found to upgrade." });
        }
      } catch (error) {
        console.error("PUT /api/profile/upgrade-premium error:", error);
        res.status(500).json({ success: false, message: "Server error during premium upgrade" });
      }
    });

    // Sales Analytics পেজের জন্য পেমেন্ট হিস্টোরি তুলে আনার রুট
    app.get("/api/payments/history", async (req, res) => {
      try {
        const { email } = req.query;
        if (!email) {
          return res.status(400).json({ success: false, error: "Email query param is required" });
        }

        const query = { email: email };
        const result = await transactionsCollection.find(query).sort({ date: -1 }).toArray();
        
        res.status(200).json({ success: true, data: result });
      } catch (error) {
        console.error("GET /api/payments/history error:", error);
        res.status(500).json({ error: "Internal Server Error" });
      }
    });

    // 📤 ২. GET Method: 
    app.get("/api/artworks", async (req, res) => {
      try {
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

    app.delete("/api/artworks/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await artworksCollection.deleteOne(query);
        res.status(200).json(result); 
      } catch (error) {
        res.status(500).json({ error: "Failed to delete artwork" });
      }
    });

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

    app.get("/api/profile", async (req, res) => {
      try {
        const id = req.query.id;
        if (!id || id === "undefined") {
          return res.status(400).json({ success: false, message: "User Unique ID is required" });
        }

        const query = { _id: new ObjectId(id) };
        const userProfile = await usersCollection.findOne(query);

        if (!userProfile) {
          return res.status(200).json({ success: true, data: null, message: "New user profile context" });
        }

        res.status(200).json({ success: true, data: userProfile });
      } catch (error) {
        console.error("GET /api/profile error:", error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
      }
    });

    app.put("/api/profile/update", async (req, res) => {
      try {
        const id = req.query.id;
        const updatedData = req.body;

        if (!id || id === "undefined") {
          return res.status(400).json({ success: false, message: "User Unique ID is required to update profile." });
        }

        const filter = { _id: new ObjectId(id) };
        const options = { upsert: true }; 

        const updateDoc = {
          $set: {
            name: updatedData.name,
            email: updatedData.email,
            role: updatedData.role,
            profileStyle: updatedData.profileStyle,
            avatar: updatedData.avatar,
            image: updatedData.avatar,
            updatedAt: new Date()
          },
        };

        const result = await usersCollection.updateOne(filter, updateDoc, options);
        res.status(200).json({ success: true, message: "Profile updated successfully!", data: result });
      } catch (error) {
        console.error("PUT /api/profile/update error:", error);
        res.status(500).json({ success: false, message: "Server error during profile update" });
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