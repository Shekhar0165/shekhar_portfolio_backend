const mongoose = require('mongoose');

const MONGODB_URI = 'mongodb://localhost:27017/portfolio';

const BlogSchema = new mongoose.Schema({
    title: String,
    slug: String,
    content: String,
    excerpt: String,
    coverImage: String,
    published: Boolean,
    seoKeywords: [String],
    tags: [String],
    author: String,
    readingTime: String,
    metaDescription: String
}, { timestamps: true });

const Blog = mongoose.model('Blog', BlogSchema);

const samplePosts = [
    {
        title: "Getting Started with Docker: A Complete Guide for Beginners",
        slug: "getting-started-with-docker",
        excerpt: "Learn the fundamentals of Docker, from containers and images to orchestration and best practices.",
        content: `
            <h2>Introduction</h2>
            <p>Docker has revolutionized the way we build, ship, and run applications. By packaging applications into containers, we ensure consistency across different environments.</p>
            <h3>What is a Container?</h3>
            <p>A container is a lightweight, standalone, executable package of software that includes everything needed to run an application: code, runtime, system tools, system libraries and settings.</p>
            <pre><code class="language-bash">docker run -d -p 80:80 nginx</code></pre>
            <h3>Key Concepts</h3>
            <ul>
                <li><strong>Images:</strong> The blueprints for containers.</li>
                <li><strong>Containers:</strong> Running instances of images.</li>
                <li><strong>Dockerfile:</strong> A script containing instructions to build an image.</li>
            </ul>
        `,
        coverImage: "https://images.unsplash.com/photo-1605745341112-85968b193ef5?w=800&auto=format&fit=crop",
        published: true,
        seoKeywords: ["docker", "containers", "devops", "guide"],
        tags: ["DevOps", "Docker", "Tutorial"],
        author: "Shekhar Kashyap",
        readingTime: "5 min read",
        metaDescription: "A comprehensive beginner's guide to Docker containers and images."
    },
    {
        title: "Building a REST API with Node.js and PostgreSQL",
        slug: "building-rest-api-nodejs-postgresql",
        excerpt: "A step-by-step tutorial on creating a robust RESTful API using Express, Node.js, and PostgreSQL database.",
        content: `
            <h2>Setting Up the Project</h2>
            <p>Node.js combined with PostgreSQL is a powerful stack for building scalable backends. In this tutorial, we will use Express and Sequelize ORM.</p>
            <h3>Prerequisites</h3>
            <p>Make sure you have Node.js and PostgreSQL installed on your system.</p>
            <pre><code class="language-javascript">const express = require('express');
const app = express();
app.listen(3000, () => console.log('Server running!'));</code></pre>
            <h3>Database Connection</h3>
            <p>Use Sequelize to define your models and sync them with your database tables.</p>
        `,
        coverImage: "https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=800&auto=format&fit=crop",
        published: true,
        seoKeywords: ["nodejs", "express", "postgresql", "api"],
        tags: ["Backend", "Node.js", "Database"],
        author: "Shekhar Kashyap",
        readingTime: "8 min read",
        metaDescription: "Master REST API development with Node.js and PostgreSQL."
    },
    {
        title: "CI/CD Pipeline Setup with GitHub Actions",
        slug: "ci-cd-pipeline-github-actions",
        excerpt: "Automate your workflow with GitHub Actions. Learn how to set up continuous integration and deployment for your projects.",
        content: `
            <h2>Why CI/CD?</h2>
            <p>Continuous Integration and Continuous Deployment (CI/CD) help automate the manual steps of software delivery, reducing errors and increasing velocity.</p>
            <h3>GitHub Actions Workflow</h3>
            <p>Define your workflow in a .yaml file within the .github/workflows directory.</p>
            <pre><code class="language-yaml">name: CI
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Run tests
        run: npm test</code></pre>
        `,
        coverImage: "https://images.unsplash.com/photo-1618401471353-b98afee0b2eb?w=800&auto=format&fit=crop",
        published: true,
        seoKeywords: ["github actions", "ci/cd", "automation", "devops"],
        tags: ["DevOps", "CI/CD", "Cloud"],
        author: "Shekhar Kashyap",
        readingTime: "6 min read",
        metaDescription: "Learn how to automate your development workflow with GitHub Actions CI/CD."
    }
];

async function seed() {
    try {
        await mongoose.connect(MONGODB_URI);
        console.log('Connected to MongoDB');

        await Blog.deleteMany({}); // Optional: clear existing
        await Blog.insertMany(samplePosts);

        console.log('Successfully seeded 3 sample posts!');
        process.exit(0);
    } catch (err) {
        console.error('Seed failed:', err);
        process.exit(1);
    }
}

seed();
