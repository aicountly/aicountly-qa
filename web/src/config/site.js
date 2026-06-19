const APP_NAME = import.meta.env.VITE_APP_NAME || 'SISPL'
const PAYMENT_URL = import.meta.env.VITE_PAYMENT_URL || ''

export const site = {
  name: APP_NAME,
  tagline: 'Smart IT Solutions for Modern Business',
  email: 'rahul@sispl.org',
  phone: '9041471715',
  address: 'Third Floor, Ajanta Enclaves, 3069, Sector-51D, Chandigarh, 160043',
  paymentUrl: PAYMENT_URL,
}

export const navLinks = [
  { label: 'Home', href: '#home' },
  { label: 'Services', href: '#services' },
  { label: 'About', href: '#about' },
  { label: 'Why Us', href: '#why-us' },
  { label: 'Contact', href: '#contact' },
]

export const services = [
  {
    title: 'Cloud & DevOps',
    description: 'Migrate, scale, and automate on AWS, Azure, and GCP with CI/CD pipelines built for reliability.',
    icon: '☁️',
  },
  {
    title: 'Custom Software',
    description: 'Web and mobile applications tailored to your workflows — from MVP to enterprise-grade platforms.',
    icon: '💻',
  },
  {
    title: 'Cybersecurity',
    description: 'Threat monitoring, penetration testing, and compliance frameworks to protect your digital assets.',
    icon: '🛡️',
  },
  {
    title: 'Managed IT',
    description: '24/7 helpdesk, infrastructure monitoring, and proactive maintenance so your team stays productive.',
    icon: '⚙️',
  },
  {
    title: 'Data & AI',
    description: 'Analytics dashboards, automation, and AI integrations that turn data into actionable insights.',
    icon: '📊',
  },
  {
    title: 'Digital Transformation',
    description: 'Process digitization, ERP integration, and change management for seamless modernization.',
    icon: '🚀',
  },
]

export const stats = [
  { value: '150+', label: 'Projects Delivered' },
  { value: '98%', label: 'Client Satisfaction' },
  { value: '12+', label: 'Years Experience' },
  { value: '24/7', label: 'Support Available' },
]

export const reasons = [
  {
    title: 'Certified Experts',
    description: 'Our engineers hold industry certifications across cloud, security, and software development.',
  },
  {
    title: 'Agile Delivery',
    description: 'Transparent sprints, weekly demos, and rapid iteration keep your project on track and on budget.',
  },
  {
    title: 'End-to-End Partner',
    description: 'From strategy and design to deployment and support — one team, one accountable partner.',
  },
  {
    title: 'Secure by Design',
    description: 'Security and compliance are built into every layer, not bolted on at the end.',
  },
]

export const testimonials = [
  {
    quote: 'SISPL transformed our legacy systems into a modern cloud platform in under six months. Exceptional team.',
    author: 'Rajesh K.',
    role: 'CTO, FinServe India',
  },
  {
    quote: 'Their managed IT service cut our downtime by 80%. Responsive, professional, and truly proactive.',
    author: 'Priya M.',
    role: 'Operations Head, RetailCo',
  },
]
