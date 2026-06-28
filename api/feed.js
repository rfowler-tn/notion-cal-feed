import { Client } from '@notionhq/client';
import { createEvents } from 'ics';

// Initialize Notion client with your API key
const notion = new Client({ auth: process.env.NOTION_API_KEY });
const databaseId = process.env.NOTION_DATABASE_ID;

export default async function handler(req, res) {
  try {
    // 1. Query the Notion Database for pages that have a date
    const response = await notion.databases.query({
      database_id: databaseId,
      filter: {
        property: 'Date', // Ensure this matches the exact name of your Date property in Notion
        date: {
          is_not_empty: true,
        },
      },
    });

    // 2. Map Notion data to the ICS event format
    const events = response.results.map((page) => {
      // Safely extract the title and date
      const title = page.properties.Name.title[0]?.plain_text || 'Untitled Event';
      const dateStr = page.properties.Date.date.start; 
      
      // Convert standard YYYY-MM-DD into the [YYYY, MM, DD] array required by the ics library
      const [year, month, day] = dateStr.split('T')[0].split('-').map(Number);

      return {
        title: title,
        start: [year, month, day],
        url: page.url,
        // You can add more mapping here (e.g., descriptions, exact start/end times)
      };
    });

    // 3. Generate the .ics string
    const { error, value } = createEvents(events);

    if (error) {
      throw error;
    }

    // 4. Serve the .ics file dynamically
    res.setHeader('Content-Type', 'text/calendar');
    res.setHeader('Content-Disposition', 'attachment; filename="notion-feed.ics"');
    res.status(200).send(value);
    
  } catch (error) {
    console.error('Error generating calendar:', error);
    res.status(500).json({ error: 'Failed to generate calendar feed' });
  }
}
