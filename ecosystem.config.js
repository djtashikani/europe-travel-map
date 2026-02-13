module.exports = {
  apps: [{
    name: "europe-travel-map",
    script: "server-sqlite.js",
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: "200M",
    env: { NODE_ENV: "production", PORT: 3004 }
  }]
};
