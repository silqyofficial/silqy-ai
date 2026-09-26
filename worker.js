const SHOPIFY_API_VERSION = "2026-07";
const AI_MODEL = "@cf/meta/llama-3.2-3b-instruct";

const SYSTEM_PROMPT = `
You are SILQY's AI shopping assistant.

SILQY is a modern jewellery brand.

Your job:
- Help customers discover SILQY products.
- Use ONLY the Shopify product information provided to you.
- Give accurate product names, descriptions, prices and stock information.
- If a product is not in the catalogue data, say: "We don't currently have that in our collection."
Always speak as SILQY using "we" and "our", never "I" or "my" when talking about the brand or catalogue.
Never invent product names, descriptions, prices, stock, or features.
Only describe information explicitly provided by Shopify.
- NEVER invent a product, price, discount, stock status or policy.
- Keep answers friendly, elegant and concise.
- For product recommendations, mention the actual product name and price.
- If a customer asks for something similar, alternatives, or "show me something like this", recommend only other products from the LIVE SILQY Shopify catalogue that have similar category, style, tags, description, or price.
- Never recommend the exact same product as a similar alternative.
- If the customer asks about orders, returns, shipping, COD or other information that is not provided, say that you can help with product information but don't have that information yet.
`;

async function getShopifyAccessToken(env) {
  const response = await fetch(
    `https://${env.SHOPIFY_STORE_DOMAIN}/admin/oauth/access_token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: env.SHOPIFY_CLIENT_ID,
        client_secret: env.SHOPIFY_CLIENT_SECRET,
      }),
    }
  );

  const data = await response.json();

  if (!response.ok || !data.access_token) {
    throw new Error("Unable to authenticate with Shopify");
  }

  return data.access_token;
}

async function getShopifyProducts(env) {
  const accessToken = await getShopifyAccessToken(env);

  const query = `
    query GetProducts {
      products(first: 50) {
        nodes {
          id
          title
          handle
                featuredImage {
        url
        altText
      }
          description
          productType
          tags
          totalInventory
          onlineStoreUrl
          priceRangeV2 {
            minVariantPrice {
              amount
              currencyCode
            }
            maxVariantPrice {
              amount
              currencyCode
            }
          }
          variants(first: 20) {
  nodes {
    id
    title
    price
    inventoryQuantity
              selectedOptions {
                name
                value
              }
            }
          }
        }
      }
    }
  `;

  const response = await fetch(
    `https://${env.SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({ query }),
    }
  );

  const data = await response.json();

  if (!response.ok || data.errors) {
    throw new Error("Unable to read Shopify products");
  }

  return data.data.products.nodes;
}

function formatProducts(products) {
  return products.map((product) => ({
    name: product.title,
    image: product.featuredImage?.url || null,
    description: product.description,
    type: product.productType,
    tags: product.tags,
    stock: product.totalInventory > 0 ? "In stock" : "Out of stock",
    price:
      product.priceRangeV2.minVariantPrice.amount ===
      product.priceRangeV2.maxVariantPrice.amount
        ? `${product.priceRangeV2.minVariantPrice.amount} ${product.priceRangeV2.minVariantPrice.currencyCode}`
        : `${product.priceRangeV2.minVariantPrice.amount}-${product.priceRangeV2.maxVariantPrice.amount} ${product.priceRangeV2.minVariantPrice.currencyCode}`,
    url: product.onlineStoreUrl,
    variants: product.variants.nodes.map((variant) => ({
  id: variant.id,
  name: variant.title,
  price: variant.price,
  stock: variant.inventoryQuantity,
  options: variant.selectedOptions,
})),
  }));
}

async function answerWithAI(env, messages, products) {
  const latestUserMessage =
    [...messages].reverse().find(m => m.role === "user")?.content?.toLowerCase() || "";

const styleKeywords = [
  "gold",
  "silver",
  "black",
  "white",
  "rose gold",
  "minimal",
  "minimalist",
  "elegant",
  "classic",
  "statement"
];

const requestedStyles = styleKeywords.filter(style =>
  latestUserMessage.includes(style)
);

  const categoryKeywords = {
    bracelet: ["bracelet", "bracelets", "bangle", "bangels"],
    ring: ["ring", "rings"],
    chain: ["chain", "chains"],
    watch: ["watch", "watches"],
    earring: ["earring", "earrings"],
    pendant: ["pendant", "pendants"],
    jhumka: ["jhumka", "jhumkas"],
    "claw clip": ["claw clip", "claw clips"]
  };

  const priceMatch = latestUserMessage.match(
  /(?:under|below|less than|upto|up to)\s*₹?\s*(\d+)/i
);

const maxPrice = priceMatch ? Number(priceMatch[1]) : null;



let relevantProducts = products;

  for (const [category, keywords] of Object.entries(categoryKeywords)) {
    if (keywords.some(keyword => latestUserMessage.includes(keyword))) {
      relevantProducts = products.filter(product => {
        const name = (product.name || "").toLowerCase();
        const type = (product.type || "").toLowerCase();
        const tags = (product.tags || []).join(" ").toLowerCase();
        const description = (product.description || "").toLowerCase();

        const searchableText =
          `${name} ${type} ${tags} ${description}`;

        const matchesCategory = keywords.some(keyword =>
          searchableText.includes(keyword)
        );

        // Never show a clearly named product from another category.
        if (
          category === "bracelet" &&
          /\bring\b/.test(name)
        ) return false;

        if (
          category === "ring" &&
          /\bbracelet\b/.test(name)
        ) return false;

        return matchesCategory;
      });

      break;
    }
  }

 if (requestedStyles.length) {
  relevantProducts = relevantProducts.filter(product => {
    const searchableText = [
      product.name,
      product.type,
      ...(product.tags || []),
      product.description
    ]
      .join(" ")
      .toLowerCase();

    return requestedStyles.some(style =>
      searchableText.includes(style)
    );
  });
}

   const productContext = JSON.stringify(
    formatProducts(relevantProducts)
  );

  const aiMessages = [
    {
      role: "system",
      content:
        SYSTEM_PROMPT +
        "\n\nIMPORTANT CATEGORY RULE: Only recommend products that match the customer's requested category. Never call a ring a bracelet, a chain a pendant, etc." +
        "\n\nLIVE SILQY SHOPIFY CATALOGUE:\n" +
        productContext,
    },
    ...messages,
  ];

  const aiResult = await env.AI.run(AI_MODEL, {
  messages: aiMessages,
  max_tokens: 500,
});

return {
  response: aiResult.response,
  products: formatProducts(relevantProducts),
};
}
function html() {
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SILQY AI</title>
<style>
body {
  margin: 0;
  background: #faf9f7;
  color: #171717;
  font-family: Arial, sans-serif;
}
.header {
  padding: 24px 20px 14px;
  text-align: center;
  border-bottom: 1px solid #e5e2dd;
}
.logo {
  font-size: 30px;
  letter-spacing: 7px;
  font-weight: 500;
}
.subtitle {
  margin-top: 7px;
  font-size: 11px;
  letter-spacing: 3px;
  opacity: .6;
}
.chat {
  max-width: 700px;
  margin: auto;
  padding: 20px;
}
.message {
  margin: 12px 0;
  padding: 13px 15px;
  border-radius: 14px;
  line-height: 1.5;
  white-space: pre-wrap;
}
.user {
  background: #171717;
  color: white;
  margin-left: 35px;
}
.ai {
  background: white;
  border: 1px solid #e5e2dd;
  margin-right: 35px;
}
.input {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 12px;
  background: rgba(250,249,247,.96);
  border-top: 1px solid #e5e2dd;
  display: flex;
  gap: 8px;
}
input {
  flex: 1;
  padding: 14px;
  border: 1px solid #ccc;
  border-radius: 25px;
  font-size: 16px;
}
button {
  border: 0;
  border-radius: 25px;
  padding: 0 20px;
  background: #171717;
  color: white;
  font-size: 15px;
}
.product-card {
  background: #fff;
  border: 1px solid #e5e2dd;
  border-radius: 16px;
  padding: 12px;
  margin: 12px 0;
  box-shadow: 0 4px 18px rgba(0,0,0,.06);
}

.product-image {
  width: 100%;
  display: block;
  aspect-ratio: 1 / 1;
  object-fit: cover;
  border-radius: 12px;
  margin-bottom: 12px;
}

.product-name {
  font-size: 17px;
  font-weight: 600;
  margin-bottom: 6px;
}

.product-price {
  font-size: 16px;
  margin-bottom: 12px;
}

.product-link {
  display: inline-block;
  background: #171717;
  color: #fff;
  text-decoration: none;
  padding: 10px 16px;
  border-radius: 22px;
  font-size: 14px;
}   </style>
</head>
<body>

<div class="header">
  <div class="logo">SILQY</div>
  <div class="subtitle">AI SHOPPING ASSISTANT</div>
</div>

<div id="chat" class="chat">
  <div class="message ai">
    Hi! I'm SILQY AI ✨<br><br>
    I can help you find jewellery from our collection.
  </div>
</div>

<div class="input">
  <input id="input" placeholder="Ask about SILQY jewellery..." />
  <button onclick="send()">Send</button>
</div>

<script>
const messages = [];

function addMessage(text, type) {
async function addToCart(variantId) {
  try {
    const response = await fetch("/cart/add.js", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        items: [
          {
            id: variantId,
            quantity: 1
          }
        ]
      })
    });

    if (!response.ok) {
      throw new Error("Cart request failed");
    }

    window.location.href = "/cart";
  } catch (error) {
    alert("Sorry, we couldn't add this item to your cart.");
  }
}
  const div = document.createElement("div");
  div.className = "message " + type;
  div.textContent = text;
  document.getElementById("chat").appendChild(div);
  window.scrollTo(0, document.body.scrollHeight);
}

async function send() {
  const input = document.getElementById("input");
  const text = input.value.trim();

  if (!text) return;

  input.value = "";

  addMessage(text, "user");

  messages.push({
    role: "user",
    content: text
  });

  addMessage("Thinking...", "ai");

  try {
    const response = await fetch("/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ messages })
    });

    const data = await response.json();

    const lastAI = document.querySelector(".ai:last-child");

lastAI.textContent =
  data.reply || "Sorry, I couldn't respond right now.";

if (data.products && data.products.length) {
  data.products.slice(0, 4).forEach(product => {
    const card = document.createElement("div");
    card.className = "product-card";

    card.innerHTML =
  (product.image
    ? '<img src="' + product.image + '" class="product-image" alt="' + product.name + '">'
    : "") +
  '<div class="product-name">' + product.name + "</div>" +
  '<div class="product-price">₹' + product.price + "</div>" +
  (product.url
    ? '<a href="' + product.url + '" target="_blank" class="product-link">View Product →</a>'
    : "");

document.getElementById("chat").appendChild(card);
  });
}

    messages.push({
      role: "assistant",
      content: data.reply
    });
  } catch (error) {
    document.querySelector(".ai:last-child").textContent =
      "Sorry, something went wrong. Please try again.";
  }
}

document.getElementById("input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") send();
});

</script>

</body>
</html>`;

}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET") {
      return new Response(html(), {
        headers: {
          "Content-Type": "text/html;charset=UTF-8",
        },
      });
    }

    if (request.method === "POST" && url.pathname === "/chat") {
      try {
        const body = await request.json();

        const messages = Array.isArray(body.messages)
          ? body.messages.slice(-10)
          : [];

        const products = await getShopifyProducts(env);

        const result = await answerWithAI(
          env,
          messages,
          products
        );

        return Response.json({
  reply: result.response,
  products: result.products,
});
      } catch (error) {
        return Response.json(
          {
            reply:
              "I'm having trouble connecting to the SILQY catalogue right now. Please try again.",
          },
          { status: 500 }
        );
      }
    }

    return new Response("Not found", { status: 404 });
  },
};
