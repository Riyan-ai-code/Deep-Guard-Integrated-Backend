const nodemailer = require('nodemailer');

exports.sendBugReport = async (req, res) => {
    const { name, email, description } = req.body;

    if (!description) {
        return res.status(400).json({ error: 'Description is required' });
    }

    try {
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS,
            },
        });

        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: process.env.EMAIL_USER, // Send to self
            subject: `Deep-Guard Bug Report from ${name || 'Anonymous'}`,
            text: `
                Name: ${name || 'N/A'}
                Email: ${email || 'N/A'}
                
                Issue Description:
                ${description}
            `,
        };

        await transporter.sendMail(mailOptions);

        res.status(200).json({ message: 'Bug report sent successfully' });
    } catch (error) {
        console.error('Error sending bug report:', error);
        res.status(500).json({ error: 'Failed to send bug report' });
    }
};
