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
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const JWKS = createRemoteJWKSet(
  new URL(`${process.env.CLIENT_URL}/api/auth/jwks`),
);

const verifyToken = async (req, res, next) => {
  const authHeader = req?.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const token = authHeader.split(" ")[1];
  if (!token) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const { payload } = await jwtVerify(token, JWKS);
    console.log(payload);
    next();
  } catch (error) {
    return res.status(403).json({ message: "Forbidden" });
  }
};






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
    const purchasesCollection = db.collection("purchased_artworks");

    // ১. POST Method:
    app.post("/api/artworks", verifyToken, async (req, res) => {
      try {
        const artworkData = req.body;
        
        if (!artworkData.title || !artworkData.image || !artworkData.artistEmail) {
          return res.status(400).json({ success: false, error: "Missing required fields" });
        }

        const currentCount = await artworksCollection.countDocuments({ artistEmail: artworkData.artistEmail });
        const artistUser = await usersCollection.findOne({ email: artworkData.artistEmail });
        const userTier = artistUser?.tier || "free"; // defolt 'free'

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
          status: "pending", // pending artist
          createdAt: new Date()
        });

        res.status(201).json(result);

      } catch (error) {
        console.error("POST /api/artworks error:", error);
        res.status(500).json({ error: "Internal Server Error" });
      }
    });

    
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
            plan: "premium",
            updatedAt: new Date()
          },
        };

        const result = await usersCollection.updateOne(filter, updateDoc);
        
        
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

    // User subscription tier upgrade
    app.put("/api/profile/upgrade-user-tier", async (req, res) => {
      try {
        const { email, tier, amount, paymentIntentId } = req.body;

        if (!email || !tier) {
          return res.status(400).json({ success: false, message: "Email and tier are required." });
        }

        const filter = { email: email };
        const updateDoc = {
          $set: {
            tier: tier.toLowerCase(),
            plan: tier.toLowerCase(),
            isPremium: tier.toLowerCase() === "premium",
            updatedAt: new Date()
          },
        };

        const result = await usersCollection.updateOne(filter, updateDoc);

        const transactionDoc = {
          email: email,
          amount: Number(amount) || 0,
          transactionId: paymentIntentId || `TXN_${Date.now()}`,
          packageName: `${tier.charAt(0).toUpperCase() + tier.slice(1)} Tier Upgrade`,
          date: new Date()
        };
        await transactionsCollection.insertOne(transactionDoc);

        res.status(200).json({ success: true, message: `Account upgraded to ${tier} successfully!` });
      } catch (error) {
        console.error("PUT /api/profile/upgrade-user-tier error:", error);
        res.status(500).json({ success: false, message: "Server error during tier upgrade" });
      }
    });

    // Post purchases (buy artwork under tier limits)
    app.post("/api/purchases", async (req, res) => {
      try {
        const { userEmail, artworkId } = req.body;

        if (!userEmail || !artworkId) {
          return res.status(400).json({ success: false, error: "userEmail and artworkId are required" });
        }

        // Get artwork details
        const artwork = await artworksCollection.findOne({ _id: new ObjectId(artworkId) });
        if (!artwork) {
          return res.status(404).json({ success: false, error: "Artwork not found" });
        }

        // Get user details for subscription verification
        const user = await usersCollection.findOne({ email: userEmail });
        const userTier = user?.tier?.toLowerCase() || "free";

        // Count existing purchases
        const purchasedCount = await purchasesCollection.countDocuments({ userEmail: userEmail });

        // Enforce Limits
        let limit = 3;
        if (userTier === "pro") limit = 9;
        if (userTier === "premium") limit = Infinity;

        if (purchasedCount >= limit) {
          return res.status(403).json({
            success: false,
            error: `Limit Reached! Your subscription (${userTier}) is limited to ${limit} artworks. Please upgrade your subscription.`
          });
        }

        // Check if already purchased
        const existingPurchase = await purchasesCollection.findOne({
          userEmail: userEmail,
          artworkId: new ObjectId(artworkId)
        });

        if (existingPurchase) {
          return res.status(400).json({ success: false, error: "You have already purchased this artwork." });
        }

        // Log the purchase
        const purchaseDoc = {
          userEmail,
          artworkId: new ObjectId(artworkId),
          artworkTitle: artwork.title,
          artworkImage: artwork.image,
          artistName: artwork.artistName,
          artistEmail: artwork.artistEmail,
          price: Number(artwork.price),
          purchaseDate: new Date(),
          referenceId: `TXN-${Math.floor(100000 + Math.random() * 900000)}`,
          status: "Successful"
        };

        const result = await purchasesCollection.insertOne(purchaseDoc);
        res.status(201).json({ success: true, message: "Artwork purchased successfully!", data: result });
      } catch (error) {
        console.error("POST /api/purchases error:", error);
        res.status(500).json({ success: false, error: "Internal Server Error" });
      }
    });

    // Get user purchases
    app.get("/api/purchases", async (req, res) => {
      try {
        const { email } = req.query;
        if (!email) {
          return res.status(400).json({ success: false, error: "Email query param is required" });
        }

        const result = await purchasesCollection.find({ userEmail: email }).sort({ purchaseDate: -1 }).toArray();
        res.status(200).json({ success: true, data: result });
      } catch (error) {
        console.error("GET /api/purchases error:", error);
        res.status(500).json({ success: false, error: "Internal Server Error" });
      }
    });

    // Sales Analytics
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
    // status "approved" 
    const result = await artworksCollection.find({ status: "approved" }).sort({ _id: -1 }).toArray();
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch artworks" });
  }
});

    // dinamick routh 
    app.get("/api/artworks/:id",verifyToken, async (req, res) => {
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

    app.delete("/api/artworks/:id",verifyToken, async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await artworksCollection.deleteOne(query);
        res.status(200).json(result); 
      } catch (error) {
        res.status(500).json({ error: "Failed to delete artwork" });
      }
    });

    app.put("/api/artworks/:id",verifyToken, async (req, res) => {
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

  
    //  ADMIN ROUTHS: USER MANAGEMENT
    app.get("/api/admin/users", async (req, res) => {
      try {
       
        const result = await usersCollection.find({}).toArray();
        res.status(200).json({ success: true, data: result });
      } catch (error) {
        console.error("GET /api/admin/users error:", error);
        res.status(500).json({ success: false, error: "Failed to fetch users list" });
      }
    });

    // (user / artist / admin) API add
    app.patch("/api/admin/update-role", async (req, res) => {
      try {
        const { userId, newRole } = req.body;

        if (!userId || !newRole) {
          return res.status(400).json({ success: false, error: "Missing userId or newRole" });
        }
        const validRoles = ["user", "artist", "admin"];
        if (!validRoles.includes(newRole.toLowerCase())) {
          return res.status(400).json({ success: false, error: "Invalid role type" });
        }

        const filter = { _id: new ObjectId(userId) };
        const updateDoc = {
          $set: {
            role: newRole.toLowerCase(),
            updatedAt: new Date()
          },
        };

        const result = await usersCollection.updateOne(filter, updateDoc);

        if (result.modifiedCount > 0 || result.matchedCount > 0) {
          res.status(200).json({ 
            success: true, 
            message: `User role successfully updated to ${newRole}! 🎉` 
          });
        } else {
          res.status(404).json({ success: false, error: "User not found to update role" });
        }
      } catch (error) {
        console.error("PATCH /api/admin/update-role error:", error);
        res.status(500).json({ success: false, error: "Internal Server Error" });
      }
    });







//  ADMIN ROUTES: ARTWORK MANAGEMENT
// (pending + approved)
app.get("/api/admin/artworks", async (req, res) => {
  try {
    const result = await artworksCollection.find({}).sort({ _id: -1 }).toArray();
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error("GET /api/admin/artworks error:", error);
    res.status(500).json({ success: false, error: "Failed to fetch all artworks" });
  }
});


// admin Approve and Publish API
app.patch("/api/admin/approve-artwork/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const filter = { _id: new ObjectId(id) };
    const updateDoc = {
      $set: { status: "approved", publishedAt: new Date() }
    };
    
    const result = await artworksCollection.updateOne(filter, updateDoc);
    if (result.modifiedCount > 0) {
      res.status(200).json({ success: true, message: "Artwork approved and published successfully! 🚀" });
    } else {
      res.status(404).json({ success: false, error: "Artwork not found or already approved" });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});


    //  ADMIN ROUTES: FINANCIAL TRANSACTIONS
  

    app.get("/api/admin/transactions", async (req, res) => {
      try {
       
        const result = await transactionsCollection.find({}).sort({ date: -1 }).toArray();
        const formattedData = result.map(tx => ({
          ...tx,
        
          type: tx.packageName ? "Subscription" : "Purchase"
        }));

        res.status(200).json({ success: true, data: formattedData });
      } catch (error) {
        console.error("GET /api/admin/transactions error:", error);
        res.status(500).json({ success: false, error: "Internal Server Error" });
      }
    });



   
    // ADMIN ROUTES: ANALYTICS OVERVIEW
  
    app.get("/api/admin/analytics-data", async (req, res) => {
      try {
    
        const totalUsers = await usersCollection.countDocuments({ role: "user" });
        const totalArtists = await usersCollection.countDocuments({ role: "artist" });
        const totalArtworksSold = await transactionsCollection.countDocuments({ packageName: { $exists: false } });

        const revenueAggregation = await transactionsCollection.aggregate([
          { $group: { _id: null, total: { $sum: "$amount" } } }
        ]).toArray();
        const totalRevenue = revenueAggregation[0]?.total || 0;

      
        const monthlySales = await transactionsCollection.aggregate([
          {
            $group: {
              _id: { $dateToString: { format: "%b", date: "$date" } }, // "Jan", 
              revenue: { $sum: "$amount" }
            }
          }
        ]).toArray();

       
        const salesData = monthlySales.map(item => ({
          date: item._id,
          revenue: item.revenue
        }));


       
        const categoryAggregation = await artworksCollection.aggregate([
          {
            $group: {
              _id: "$category",
              count: { $sum: 1 }
            }
          }
        ]).toArray();

        const categoryData = categoryAggregation.map(item => ({
          name: item._id || "Uncategorized",
          count: item.count
        }));
        
        res.status(200).json({
          success: true,
          data: {
            totalUsers,
            totalArtists,
            totalArtworksSold,
            totalRevenue,
            salesData: salesData.length > 0 ? salesData : [{ date: "No Data", revenue: 0 }],
            categoryData: categoryData.length > 0 ? categoryData : [{ name: "No Data", count: 1 }]
          }
        });

      } catch (error) {
        console.error("GET /api/admin/analytics-data error:", error);
        res.status(500).json({ success: false, error: "Internal Server Error" });
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
