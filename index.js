const dns = require("node:dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);
const { createRemoteJWKSet, jwtVerify } = require("jose-cjs");
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    credentials: true,
  }),
);
app.use(express.json());

// MongoDB URI
const uri = process.env.MONGODB_URI;
let cachedClient = null;

async function connectDB() {
  if (cachedClient) return cachedClient;
  const newClient = new MongoClient(uri, {
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
    },
  });
  await newClient.connect();
  cachedClient = newClient;
  console.log("✅ Connected to MongoDB!");
  return cachedClient;
}

// Collections helper
async function getCollections() {
  const client = await connectDB();
  const db = client.db("artHub_DB");
  return {
    usersCollection: db.collection("user"),
    artworksCollection: db.collection("artworks"),
    transactionsCollection: db.collection("transactions"),
    commentsCollection: db.collection("comments"),
    purchasesCollection: db.collection("purchased_artworks"),
  };
}

// JWT Verify
const JWKS = createRemoteJWKSet(
  new URL(`${process.env.CLIENT_URL}/api/auth/jwks`),
);

const verifyToken = async (req, res, next) => {
  const authHeader = req?.headers.authorization;
  if (!authHeader) return res.status(401).json({ message: "Unauthorized" });
  const token = authHeader.split(" ")[1];
  if (!token) return res.status(401).json({ message: "Unauthorized" });
  try {
    const { payload } = await jwtVerify(token, JWKS);
    console.log(payload);
    next();
  } catch (error) {
    return res.status(403).json({ message: "Forbidden" });
  }
};

// ─── ROUTES ────────────────────────────────────────────────────────────────

app.get("/", (req, res) => {
  res.send("🎨 ArtHub Server is running perfectly!");
});

// GET all approved artworks
app.get("/api/artworks", async (req, res) => {
  try {
    const { artworksCollection } = await getCollections();
    const result = await artworksCollection
      .find({ status: "approved" })
      .sort({ _id: -1 })
      .toArray();
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error("GET /api/artworks error:", error);
    res.status(500).json({ error: "Failed to fetch artworks" });
  }
});

// POST new artwork
app.post("/api/artworks", verifyToken, async (req, res) => {
  try {
    const { artworksCollection, usersCollection } = await getCollections();
    const artworkData = req.body;

    if (!artworkData.title || !artworkData.image || !artworkData.artistEmail) {
      return res
        .status(400)
        .json({ success: false, error: "Missing required fields" });
    }

    const currentCount = await artworksCollection.countDocuments({
      artistEmail: artworkData.artistEmail,
    });
    const artistUser = await usersCollection.findOne({
      email: artworkData.artistEmail,
    });
    const userTier = artistUser?.tier || "free";

    if (userTier === "free" && currentCount >= 3) {
      return res.status(403).json({
        success: false,
        error:
          "Limit Reached! standard accounts are limited to 3 artworks. Please upgrade your subscription tier.",
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
      status: "pending",
      createdAt: new Date(),
    });

    res.status(201).json(result);
  } catch (error) {
    console.error("POST /api/artworks error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// GET single artwork
app.get("/api/artworks/:id", verifyToken, async (req, res) => {
  try {
    const { artworksCollection } = await getCollections();
    const result = await artworksCollection.findOne({
      _id: new ObjectId(req.params.id),
    });
    if (!result)
      return res
        .status(404)
        .json({ success: false, error: "Artwork not found" });
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: "Invalid ID format or Server Error" });
  }
});

// DELETE artwork
app.delete("/api/artworks/:id", verifyToken, async (req, res) => {
  try {
    const { artworksCollection } = await getCollections();
    const result = await artworksCollection.deleteOne({
      _id: new ObjectId(req.params.id),
    });
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: "Failed to delete artwork" });
  }
});

// PUT update artwork
app.put("/api/artworks/:id", verifyToken, async (req, res) => {
  try {
    const { artworksCollection } = await getCollections();
    const updatedData = req.body;
    const result = await artworksCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      {
        $set: {
          title: updatedData.title,
          description: updatedData.description,
          category: updatedData.category,
          price: Number(updatedData.price),
          image: updatedData.image,
        },
      },
    );
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: "Failed to update artwork" });
  }
});

// GET my artworks
app.get("/api/my-artworks", async (req, res) => {
  try {
    const { artworksCollection } = await getCollections();
    const email = req.query.email;
    if (!email)
      return res
        .status(400)
        .json({ success: false, error: "Email query param is required" });
    const result = await artworksCollection
      .find({ artistEmail: email })
      .sort({ _id: -1 })
      .toArray();
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// GET profile
app.get("/api/profile", async (req, res) => {
  try {
    const { usersCollection } = await getCollections();
    const id = req.query.id;
    if (!id || id === "undefined")
      return res
        .status(400)
        .json({ success: false, message: "User Unique ID is required" });
    const userProfile = await usersCollection.findOne({
      _id: new ObjectId(id),
    });
    if (!userProfile)
      return res.status(200).json({
        success: true,
        data: null,
        message: "New user profile context",
      });
    res.status(200).json({ success: true, data: userProfile });
  } catch (error) {
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

// PUT update profile
app.put("/api/profile/update", async (req, res) => {
  try {
    const { usersCollection } = await getCollections();
    const id = req.query.id;
    const updatedData = req.body;
    if (!id || id === "undefined")
      return res
        .status(400)
        .json({ success: false, message: "User Unique ID is required" });
    const result = await usersCollection.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          name: updatedData.name,
          email: updatedData.email,
          role: updatedData.role,
          profileStyle: updatedData.profileStyle,
          avatar: updatedData.avatar,
          image: updatedData.avatar,
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    );
    res.status(200).json({
      success: true,
      message: "Profile updated successfully!",
      data: result,
    });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Server error during profile update" });
  }
});

// PUT upgrade premium
app.put("/api/profile/upgrade-premium", async (req, res) => {
  try {
    const { usersCollection, transactionsCollection } = await getCollections();
    const { email, amount, paymentIntentId } = req.body;
    
    if (!email) {
      return res
        .status(400)
        .json({ success: false, message: "Email is required" });
    }

    if (paymentIntentId) {
      const existingTransaction = await transactionsCollection.findOne({
        transactionId: paymentIntentId
      });
      if (existingTransaction) {
        return res.status(200).json({
          success: true,
          message: "Payment already processed. Premium is already active.",
        });
      }
    }

    const result = await usersCollection.updateOne(
      { email },
      {
        $set: {
          isPremium: true,
          tier: "premium",
          plan: "premium",
          updatedAt: new Date(),
        },
      },
    );

    await transactionsCollection.insertOne({
      email,
      amount: Number(amount) || 49.0,
      transactionId: paymentIntentId || `TXN_${Date.now()}`,
      packageName: "Premium Tier Upgrade",
      date: new Date(),
    });

    if (result.modifiedCount > 0 || result.matchedCount > 0) {
      res.status(200).json({
        success: true,
        message: "Account upgraded to Premium successfully!",
      });
    } else {
      res.status(404).json({ success: false, message: "User not found" });
    }
  } catch (error) {
    console.error("Error during premium upgrade:", error);
    res.status(500).json({ success: false, message: "Server error during premium upgrade" });
  }
});




// PUT upgrade user tier
app.put("/api/profile/upgrade-user-tier", async (req, res) => {
  try {
    const { usersCollection, transactionsCollection } = await getCollections();
    const { email, tier, amount, paymentIntentId } = req.body;
    
    if (!email || !tier) {
      return res
        .status(400)
        .json({ success: false, message: "Email and tier are required" });
    }

    if (paymentIntentId) {
      const existingTxn = await transactionsCollection.findOne({
        transactionId: paymentIntentId
      });
      if (existingTxn) {
        return res.status(200).json({
          success: true,
          message: "Transaction already processed. Premium is active.",
        });
      }
    }

    await usersCollection.updateOne(
      { email },
      {
        $set: {
          tier: tier.toLowerCase(),
          plan: tier.toLowerCase(),
          isPremium: tier.toLowerCase() === "premium",
          updatedAt: new Date(),
        },
      },
    );

    await transactionsCollection.insertOne({
      email,
      amount: Number(amount) || 0,
      transactionId: paymentIntentId || `TXN_${Date.now()}`,
      packageName: `${tier.charAt(0).toUpperCase() + tier.slice(1)} Tier Upgrade`,
      date: new Date(),
    });

    res.status(200).json({
      success: true,
      message: `Account upgraded to ${tier} successfully!`,
    });
  } catch (error) {
    console.error("Error during tier upgrade:", error);
    res.status(500).json({ success: false, message: "Server error during tier upgrade" });
  }
});




// POST purchase artwork
app.post("/api/purchases", async (req, res) => {
  try {
    const { artworksCollection, usersCollection, purchasesCollection } =
      await getCollections();
    const { userEmail, artworkId } = req.body;
    if (!userEmail || !artworkId)
      return res.status(400).json({
        success: false,
        error: "userEmail and artworkId are required",
      });

    const artwork = await artworksCollection.findOne({
      _id: new ObjectId(artworkId),
    });
    if (!artwork)
      return res
        .status(404)
        .json({ success: false, error: "Artwork not found" });

    const user = await usersCollection.findOne({ email: userEmail });
    const userTier = user?.tier?.toLowerCase() || "free";
    const purchasedCount = await purchasesCollection.countDocuments({
      userEmail,
    });

    let limit = 3;
    if (userTier === "pro") limit = 9;
    if (userTier === "premium") limit = Infinity;

    if (purchasedCount >= limit) {
      return res.status(403).json({
        success: false,
        error: `Limit Reached! Your subscription (${userTier}) is limited to ${limit} artworks.`,
      });
    }

    const existingPurchase = await purchasesCollection.findOne({
      userEmail,
      artworkId: new ObjectId(artworkId),
    });
    if (existingPurchase)
      return res.status(400).json({
        success: false,
        error: "You have already purchased this artwork.",
      });

    const result = await purchasesCollection.insertOne({
      userEmail,
      artworkId: new ObjectId(artworkId),
      artworkTitle: artwork.title,
      artworkImage: artwork.image,
      artistName: artwork.artistName,
      artistEmail: artwork.artistEmail,
      price: Number(artwork.price),
      purchaseDate: new Date(),
      referenceId: `TXN-${Math.floor(100000 + Math.random() * 900000)}`,
      status: "Successful",
    });

    res.status(201).json({
      success: true,
      message: "Artwork purchased successfully!",
      data: result,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// GET user purchases
app.get("/api/purchases", async (req, res) => {
  try {
    const { purchasesCollection } = await getCollections();
    const { email } = req.query;
    if (!email)
      return res
        .status(400)
        .json({ success: false, error: "Email query param is required" });
    const result = await purchasesCollection
      .find({ userEmail: email })
      .sort({ purchaseDate: -1 })
      .toArray();
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// GET payment history
app.get("/api/payments/history", async (req, res) => {
  try {
    const { transactionsCollection } = await getCollections();
    const { email } = req.query;
    if (!email)
      return res
        .status(400)
        .json({ success: false, error: "Email query param is required" });
    const result = await transactionsCollection
      .find({ email })
      .sort({ date: -1 })
      .toArray();
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ error: "Internal Server Error" });
  }
});





// ───COMMENT SYSTEM ROUTES  ───────────────────────────────────

// ১. POST /api/artworks/:id/comments
app.post("/api/artworks/:id/comments", async (req, res) => {
  try {
    const { commentsCollection, purchasesCollection } = await getCollections();
    const artworkId = req.params.id;
    const { userId, userEmail, comment } = req.body;

    if (!userEmail || !comment) {
      return res.status(400).json({ success: false, message: "Comment and user email are required." });
    }
    const hasPurchased = await purchasesCollection.findOne({
      userEmail: userEmail,
      artworkId: new ObjectId(artworkId)
    });

    if (!hasPurchased) {
      return res.status(403).json({
        success: false,
        message: "Challenge Guard: You must purchase this artwork to leave a comment/review."
      });
    }
    const newComment = {
      artworkId: artworkId, 
      userId: userId || userEmail,
      userEmail: userEmail,
      comment: comment,
      createdAt: new Date()
    };

    const result = await commentsCollection.insertOne(newComment);
    
    res.status(201).json({
      success: true,
      message: "Comment published successfully!",
      data: { ...newComment, _id: result.insertedId }
    });

  } catch (error) {
    console.error("Error adding comment:", error);
    res.status(500).json({ success: false, message: "Server error while adding comment" });
  }
});

// ২. GET /api/artworks/:id/comments
app.get("/api/artworks/:id/comments", async (req, res) => {
  try {
    const { commentsCollection } = await getCollections();
    const artworkId = req.params.id;
    
    const comments = await commentsCollection
      .find({ artworkId: artworkId })
      .sort({ createdAt: -1 }) 
      .toArray();

    res.status(200).json({ success: true, data: comments });
  } catch (error) {
    console.error("Error fetching comments:", error);
    res.status(500).json({ success: false, message: "Server error while fetching comments" });
  }
});

// ৩. PUT /api/comments/:id 
app.put("/api/comments/:id", async (req, res) => {
  try {
    const { commentsCollection } = await getCollections();
    const commentId = req.params.id;
    const { comment, userEmail } = req.body;

  
    const existingComment = await commentsCollection.findOne({ _id: new ObjectId(commentId) });
    if (!existingComment) {
      return res.status(404).json({ success: false, message: "Comment not found" });
    }
    
    if (existingComment.userEmail !== userEmail) {
      return res.status(401).json({ success: false, message: "Unauthorized! You can only edit your own comment." });
    }

    await commentsCollection.updateOne(
      { _id: new ObjectId(commentId) },
      { $set: { comment: comment, updatedAt: new Date() } }
    );

    res.status(200).json({ success: true, message: "Comment updated successfully!" });
  } catch (error) {
    console.error("Error updating comment:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ৪. DELETE /api/comments/:id 
app.delete("/api/comments/:id", async (req, res) => {
  try {
    const { commentsCollection } = await getCollections();
    const commentId = req.params.id;
    const { userEmail } = req.body;

    const existingComment = await commentsCollection.findOne({ _id: new ObjectId(commentId) });
    if (!existingComment) {
      return res.status(404).json({ success: false, message: "Comment not found" });
    }

    if (existingComment.userEmail !== userEmail) {
      return res.status(401).json({ success: false, message: "Unauthorized! You can only delete your own comment." });
    }

    await commentsCollection.deleteOne({ _id: new ObjectId(commentId) });
    res.status(200).json({ success: true, message: "Comment deleted successfully!" });
  } catch (error) {
    console.error("Error deleting comment:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});








// ─── ADMIN ROUTES ───────────────────────────────────────────────────────────

// GET all users
app.get("/api/admin/users", async (req, res) => {
  try {
    const { usersCollection } = await getCollections();
    const result = await usersCollection.find({}).toArray();
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch users list" });
  }
});

// PATCH update user role
app.patch("/api/admin/update-role", async (req, res) => {
  try {
    const { usersCollection } = await getCollections();
    const { userId, newRole } = req.body;
    if (!userId || !newRole)
      return res
        .status(400)
        .json({ success: false, error: "Missing userId or newRole" });

    const validRoles = ["user", "artist", "admin"];
    if (!validRoles.includes(newRole.toLowerCase()))
      return res
        .status(400)
        .json({ success: false, error: "Invalid role type" });

    const result = await usersCollection.updateOne(
      { _id: new ObjectId(userId) },
      { $set: { role: newRole.toLowerCase(), updatedAt: new Date() } },
    );

    if (result.modifiedCount > 0 || result.matchedCount > 0) {
      res.status(200).json({
        success: true,
        message: `User role successfully updated to ${newRole}! 🎉`,
      });
    } else {
      res.status(404).json({ success: false, error: "User not found" });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// GET all artworks (admin)
app.get("/api/admin/artworks", async (req, res) => {
  try {
    const { artworksCollection } = await getCollections();
    const result = await artworksCollection
      .find({})
      .sort({ _id: -1 })
      .toArray();
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch all artworks" });
  }
});

// PATCH approve artwork
app.patch("/api/admin/approve-artwork/:id", async (req, res) => {
  try {
    const { artworksCollection } = await getCollections();
    const result = await artworksCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { status: "approved", publishedAt: new Date() } },
    );
    if (result.modifiedCount > 0) {
      res.status(200).json({
        success: true,
        message: "Artwork approved and published successfully! 🚀",
      });
    } else {
      res.status(404).json({
        success: false,
        error: "Artwork not found or already approved",
      });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// GET all transactions (admin)
app.get("/api/admin/transactions", async (req, res) => {
  try {
    const { transactionsCollection } = await getCollections();
    const result = await transactionsCollection
      .find({})
      .sort({ date: -1 })
      .toArray();
    const formattedData = result.map((tx) => ({
      ...tx,
      type: tx.packageName ? "Subscription" : "Purchase",
    }));
    res.status(200).json({ success: true, data: formattedData });
  } catch (error) {
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// GET analytics data (admin)
app.get("/api/admin/analytics-data", async (req, res) => {
  try {
    const { usersCollection, artworksCollection, transactionsCollection } =
      await getCollections();

    const totalUsers = await usersCollection.countDocuments({ role: "user" });
    const totalArtists = await usersCollection.countDocuments({
      role: "artist",
    });
    const totalArtworksSold = await transactionsCollection.countDocuments({
      packageName: { $exists: false },
    });

    const revenueAggregation = await transactionsCollection
      .aggregate([{ $group: { _id: null, total: { $sum: "$amount" } } }])
      .toArray();
    const totalRevenue = revenueAggregation[0]?.total || 0;

    const monthlySales = await transactionsCollection
      .aggregate([
        {
          $group: {
            _id: { $dateToString: { format: "%b", date: "$date" } },
            revenue: { $sum: "$amount" },
          },
        },
      ])
      .toArray();
    const salesData = monthlySales.map((item) => ({
      date: item._id,
      revenue: item.revenue,
    }));

    const categoryAggregation = await artworksCollection
      .aggregate([{ $group: { _id: "$category", count: { $sum: 1 } } }])
      .toArray();
    const categoryData = categoryAggregation.map((item) => ({
      name: item._id || "Uncategorized",
      count: item.count,
    }));

    res.status(200).json({
      success: true,
      data: {
        totalUsers,
        totalArtists,
        totalArtworksSold,
        totalRevenue,
        salesData:
          salesData.length > 0 ? salesData : [{ date: "No Data", revenue: 0 }],
        categoryData:
          categoryData.length > 0
            ? categoryData
            : [{ name: "No Data", count: 1 }],
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// ─── START SERVER ──────────────────
app.listen(port, () => {
  console.log(`🚀 Server is flying on port ${port}`);
});
