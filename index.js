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
    origin:"http://localhost:3000", 
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

    // -------------------------------------------------------------------------
    // ১. USER & AUTHENTICATION API (JWT ছাড়া)
    // -------------------------------------------------------------------------

    // Register/Save User
    app.post("/api/users", async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const existingUser = await usersCollection.findOne(query);

      if (existingUser) {
        return res.send({ message: "User already exists", insertedId: null });
      }

      const newUser = {
        name: user.name,
        email: user.email,
        role: user.role || "user", // user, artist, admin
        subscriptionTier: "free",
        maxPurchases: 3,
        purchasedCount: 0,
        createdAt: new Date(),
      };
      const result = await usersCollection.insertOne(newUser);
      res.send(result);
    });

    // Get User Profile Data
    app.get("/api/users/profile/:email", async (req, res) => {
      const email = req.params.email;
      const user = await usersCollection.findOne({ email });
      if (!user) return res.status(404).send({ message: "User not found" });
      res.send(user);
    });

    // -------------------------------------------------------------------------
    // ২. ARTWORKS CRUD + SEARCH + FILTER + PAGINATION
    // -------------------------------------------------------------------------

    // Get All Artworks with Search, Filter & Pagination
    app.get("/api/artworks", async (req, res) => {
      try {
        const {
          search,
          category,
          minPrice,
          maxPrice,
          sort,
          page = 1,
          limit = 6,
        } = req.query;

        let query = {};
        if (search) {
          query.$or = [
            { title: { $regex: search, $options: "i" } },
            { artistName: { $regex: search, $options: "i" } },
          ];
        }
        if (category) query.category = category;

        if (minPrice || maxPrice) {
          query.price = {};
          if (minPrice) query.price.$gte = parseFloat(minPrice);
          if (maxPrice) query.price.$lte = parseFloat(maxPrice);
        }

        let sortOptions = {};
        if (sort === "newest") sortOptions.createdAt = -1;
        else if (sort === "priceLowHigh") sortOptions.price = 1;
        else if (sort === "priceHighLow") sortOptions.price = -1;

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const totalArtworks = await artworksCollection.countDocuments(query);

        const artworks = await artworksCollection
          .find(query)
          .sort(sortOptions)
          .skip(skip)
          .limit(parseInt(limit))
          .toArray();

        res.send({
          artworks,
          totalArtworks,
          totalPages: Math.ceil(totalArtworks / limit),
        });
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });

    // Get single Artwork Details
    app.get("/api/artworks/:id", async (req, res) => {
      const id = req.params.id;
      const result = await artworksCollection.findOne({
        _id: new ObjectId(id),
      });
      if (!result)
        return res.status(404).send({ message: "Artwork not found" });
      res.send(result);
    });

    // Add Artwork (Artist only)
    app.post("/api/artworks", async (req, res) => {
      const artwork = req.body;
      artwork.price = parseFloat(artwork.price);
      artwork.createdAt = new Date();
      const result = await artworksCollection.insertOne(artwork);
      res.send(result);
    });

    // Delete Artwork
    app.delete("/api/artworks/:id", async (req, res) => {
      const id = req.params.id;
      const result = await artworksCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    // -------------------------------------------------------------------------
    // ৩. COMMENT SYSTEM
    // -------------------------------------------------------------------------

    // Post a Comment
    app.post("/api/artworks/:id/comments", async (req, res) => {
      const artworkId = req.params.id;
      const { userId, userEmail, userName, comment } = req.body;

      const newComment = {
        artworkId: new ObjectId(artworkId),
        userId,
        userEmail,
        userName,
        comment,
        createdAt: new Date(),
      };
      const result = await commentsCollection.insertOne(newComment);
      res.send(result);
    });

    // Get comments for specific artwork
    app.get("/api/artworks/:id/comments", async (req, res) => {
      const artworkId = req.params.id;
      const result = await commentsCollection
        .find({ artworkId: new ObjectId(artworkId) })
        .toArray();
      res.send(result);
    });
  } catch (error) {
    console.error(error);
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("🎨 ArtHub Server is running perfectly!");
});

app.listen(port, () => {
  console.log(`🚀 Server is flying on port ${port}`);
});
