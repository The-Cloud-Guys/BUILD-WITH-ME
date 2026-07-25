const mongoose = require('mongoose');

const skillSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  category: {
    type: String,
    enum: ['frontend', 'backend', 'devops', 'data', 'design', 'mobile', 'other'],
    default: 'other'
  },
  popularity: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, { timestamps: true });

// Pre-populated skills
const defaultSkills = [
  // Frontend
  'React', 'Vue.js', 'Angular', 'Next.js', 'Tailwind CSS', 'TypeScript',
  'JavaScript', 'HTML', 'CSS', 'SASS', 'Webpack', 'Babel',
  // Backend
  'Node.js', 'Python', 'Java', 'C#', 'Ruby', 'PHP', 'Go', 'Rust',
  'Express.js', 'Django', 'Spring Boot', 'Laravel', 'Rails',
  // Databases
  'MongoDB', 'PostgreSQL', 'MySQL', 'Redis', 'Elasticsearch',
  // Cloud & DevOps
  'AWS', 'Azure', 'GCP', 'Docker', 'Kubernetes', 'Terraform', 'Git',
  'CI/CD', 'Jenkins', 'Ansible', 'Linux',
  // Data
  'Machine Learning', 'Deep Learning', 'NLP', 'Computer Vision',
  'Data Science', 'Analytics', 'Tableau', 'Power BI',
  // Design
  'Figma', 'Adobe XD', 'Sketch', 'UI/UX', 'Graphic Design',
  // Mobile
  'React Native', 'Flutter', 'Swift', 'Kotlin', 'Android', 'iOS'
];

module.exports = {
  Skill: mongoose.model('Skill', skillSchema),
  defaultSkills
};